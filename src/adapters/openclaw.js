import { spawn } from "node:child_process";
import { normalizeScope } from "../scope.js";
import { SUMMARY_METADATA_FLAG, isSummaryMessage } from "../summary.js";

export function scopeFromOpenClaw(event = {}, ctx = {}, defaults = {}) {
  const channel = defaults.channel ?? ctx.messageProvider ?? event.channel ?? event.metadata?.channel ?? "openclaw";
  const account = defaults.persona ?? ctx.accountId ?? event.accountId ?? event.metadata?.accountId ?? process.env.OPENCLAW_ACCOUNT ?? process.env.AGENT_BRIDGE_PERSONA ?? "default";
  const session = defaults.session ?? ctx.sessionKey ?? event.sessionKey ?? event.metadata?.sessionKey ?? `${channel}:${event.to ?? event.from ?? "unknown"}`;
  const conversation = defaults.conversation ?? ctx.conversationId ?? event.conversationId ?? event.to ?? event.from ?? ctx.channelId ?? event.threadId ?? "";

  return normalizeScope({
    harness: defaults.harness ?? "openclaw",
    persona: account,
    session,
    channel,
    conversation,
  });
}

export function looksLikeOpenClawVoiceNote(event = {}) {
  const metadata = event.metadata ?? {};
  const mediaKind = String(metadata.mediaKind ?? metadata.mediaType ?? metadata.kind ?? "").toLowerCase();
  const content = String(event.content ?? event.body ?? event.transcript ?? "").toLowerCase();

  if (metadata.isVoice === true || metadata.voice === true || metadata.voiceNote === true) return true;
  if (mediaKind.includes("voice") || mediaKind.includes("audio")) return true;
  if (typeof event.transcript === "string" && event.transcript.trim()) return true;
  return /\bvoice note\b|\btranscribed\b|^transcript:/i.test(content);
}

export async function handleOpenClawMessageReceived(engine, event, ctx = {}, options = {}) {
  if (!looksLikeOpenClawVoiceNote(event)) {
    return { recorded: false, ignored: true, reason: "not-voice-note" };
  }

  return engine.recordVoiceNote({
    scope: scopeFromOpenClaw(event, ctx, options.scopeDefaults),
    timestamp: event.timestamp,
    messageId: event.messageId,
    metadata: event.metadata,
  });
}

export async function handleOpenClawMessageSent(engine, event, ctx = {}, options = {}) {
  if (event.success === false) return { recorded: false, ignored: true, reason: "send-failed" };
  if (isSummaryMessage({ ...event, metadata: event.metadata })) {
    return { recorded: false, ignored: true, reason: "summary-message" };
  }

  return engine.recordAssistantMessage({
    scope: scopeFromOpenClaw(event, ctx, options.scopeDefaults),
    timestamp: event.timestamp,
    messageId: event.messageId,
    text: event.content,
    metadata: event.metadata,
  });
}

export async function sendSummaryIfDue(engine, scope, send, options = {}) {
  const due = await engine.checkIdle({ scope, now: options.now, summaryOptions: options.summaryOptions });
  if (!due.due) return due;

  const payload = options.format === "html" ? due.summary.html : due.summary.markdown;
  const delivery = await send(payload, {
    scope: due.scope,
    messages: due.messages,
    summary: due.summary,
    metadata: { generatedBy: SUMMARY_METADATA_FLAG },
  });

  await engine.markSummarySent({
    scope: due.scope,
    timestamp: options.now ?? Date.now(),
    messageIds: due.messages.map((message) => message.id),
  });

  return { ...due, delivered: true, delivery };
}

export function openClawCliSender(options = {}) {
  const bin = options.bin ?? "openclaw";
  return async function sendWithOpenClawCli(text, ctx = {}) {
    const scope = ctx.scope ?? {};
    const channel = options.channel ?? scope.channel ?? "telegram";
    const target = options.target ?? scope.conversation;
    if (!target) throw new Error("OpenClaw CLI sender needs a target/conversation");

    const args = ["message", "send", "--channel", channel, "--target", String(target), "--message", text];
    if (options.accountId) args.push("--accountId", options.accountId);

    await new Promise((resolve, reject) => {
      const child = spawn(bin, args, {
        stdio: options.stdio ?? "ignore",
        env: { ...process.env, ...(options.env ?? {}) },
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${bin} exited with code ${code}`));
      });
    });

    return { via: "openclaw-cli", channel, target };
  };
}
