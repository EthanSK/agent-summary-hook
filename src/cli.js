import { readFile } from "node:fs/promises";
import { BurstSummaryEngine } from "./engine.js";
import { JsonFileStore, defaultStatePath } from "./storage.js";
import { parseScope } from "./scope.js";
import { SUMMARY_METADATA_FLAG } from "./summary.js";
import { handleClaudeStop, handleClaudeUserPromptSubmit } from "./adapters/claude-code.js";
import { openClawCliSender, sendSummaryIfDue } from "./adapters/openclaw.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    if (eq >= 0) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function readStdin(stdin = process.stdin) {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function textFromArgs(args, stdin) {
  if (args.text !== undefined) return String(args.text);
  if (args.file) return readFile(String(args.file), "utf8");
  return readStdin(stdin);
}

function createEngine(env) {
  return new BurstSummaryEngine({
    store: new JsonFileStore(defaultStatePath(env)),
    idleMs: env.AGENT_SUMMARY_IDLE_MS ? Number(env.AGENT_SUMMARY_IDLE_MS) : undefined,
    minMessages: env.AGENT_SUMMARY_MIN_MESSAGES ? Number(env.AGENT_SUMMARY_MIN_MESSAGES) : undefined,
  });
}

function printJson(stdout, value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return `agent-summary-hook commands:
  record-voice --scope JSON [--id ID] [--at ISO]
  record-assistant --scope JSON [--id ID] [--at ISO] [--text TEXT]
  check --scope JSON [--now ISO]
  check --all [--now ISO]
  send-due --scope JSON|--all [--sender stdout|openclaw|telegram-bot]
  mark-summary-sent --scope JSON [--message-ids id1,id2] [--at ISO]
  claude-user-prompt < hook-input.json
  claude-stop < hook-input.json

Environment:
  AGENT_SUMMARY_STATE=/path/to/state.json
  AGENT_SUMMARY_IDLE_MS=300000
  AGENT_SUMMARY_MIN_MESSAGES=3
`;
}

async function sendTelegramBot(text, env, options = {}) {
  const token = options.token ?? env.AGENT_SUMMARY_TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId ?? env.AGENT_SUMMARY_TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("telegram-bot sender needs AGENT_SUMMARY_TELEGRAM_BOT_TOKEN and AGENT_SUMMARY_TELEGRAM_CHAT_ID");
  const parseMode = options.parseMode ?? env.AGENT_SUMMARY_TELEGRAM_PARSE_MODE ?? "HTML";
  const body = {
    chat_id: chatId,
    text: parseMode.toUpperCase() === "HTML" ? text : text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telegram send failed: ${response.status} ${await response.text()}`);
  return { via: "telegram-bot", ok: true };
}

function buildSender(name, env, args) {
  if (name === "openclaw") {
    return openClawCliSender({ target: args.target, channel: args.channel, accountId: args.accountId });
  }
  if (name === "telegram-bot") {
    return async (payload, ctx) => {
      const text = args.format === "markdown" ? ctx.summary.markdown : ctx.summary.html;
      return sendTelegramBot(text, env, { token: args.token, chatId: args.chatId, parseMode: args.parseMode });
    };
  }
  return async (payload, ctx) => {
    const text = args.format === "html" ? ctx.summary.html : ctx.summary.markdown;
    process.stdout.write(`${text}\n`);
    return { via: "stdout" };
  };
}

export async function runCli(argv = process.argv.slice(2), io = {}) {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const args = parseArgs(argv);
  const command = args._[0] ?? args.command;

  if (!command || command === "help" || args.help) {
    stdout.write(usage());
    return 0;
  }

  const engine = createEngine(env);

  try {
    if (command === "record-voice") {
      const result = await engine.recordVoiceNote({
        scope: parseScope(args.scope),
        id: args.id,
        messageId: args.id ?? args.messageId,
        timestamp: args.at ?? args.timestamp,
      });
      printJson(stdout, result);
      return 0;
    }

    if (command === "record-assistant") {
      const text = await textFromArgs(args, stdin);
      const result = await engine.recordAssistantMessage({
        scope: parseScope(args.scope),
        id: args.id,
        messageId: args.id ?? args.messageId,
        timestamp: args.at ?? args.timestamp,
        text,
        isSummary: args.summary === true || args.isSummary === true,
        metadata: args.generatedBy === SUMMARY_METADATA_FLAG ? { generatedBy: SUMMARY_METADATA_FLAG } : undefined,
      });
      printJson(stdout, result);
      return 0;
    }

    if (command === "check") {
      const results = args.all
        ? await engine.checkAllIdle({ now: args.now })
        : await engine.checkIdle({ scope: parseScope(args.scope), now: args.now });
      printJson(stdout, results);
      return 0;
    }

    if (command === "mark-summary-sent") {
      const result = await engine.markSummarySent({
        scope: parseScope(args.scope),
        timestamp: args.at ?? args.timestamp,
        messageIds: args.messageIds ? String(args.messageIds).split(",").filter(Boolean) : undefined,
      });
      printJson(stdout, result);
      return 0;
    }

    if (command === "send-due") {
      const senderName = args.sender ?? env.AGENT_SUMMARY_SENDER ?? "stdout";
      const send = buildSender(senderName, env, args);
      const scopes = args.all ? await engine.listScopes() : [{ scope: parseScope(args.scope) }];
      const results = [];
      for (const { scope } of scopes) {
        results.push(await sendSummaryIfDue(engine, scope, send, { now: args.now, format: args.format }));
      }
      printJson(stdout, results);
      return 0;
    }

    if (command === "claude-user-prompt") {
      const input = JSON.parse(await readStdin(stdin) || "{}");
      const result = await handleClaudeUserPromptSubmit(engine, input, {
        scopeDefaults: {
          persona: args.persona,
          channel: args.channel,
          conversation: args.conversation,
        },
      });
      printJson(stdout, result);
      return 0;
    }

    if (command === "claude-stop") {
      const input = JSON.parse(await readStdin(stdin) || "{}");
      const result = await handleClaudeStop(engine, input, {
        transcriptPath: args.transcriptPath,
        scopeDefaults: {
          persona: args.persona,
          channel: args.channel,
          conversation: args.conversation,
        },
      });
      printJson(stdout, result);
      return 0;
    }

    stderr.write(`Unknown command: ${command}\n\n${usage()}`);
    return 2;
  } catch (error) {
    stderr.write(`${error?.stack ?? error}\n`);
    return 1;
  }
}
