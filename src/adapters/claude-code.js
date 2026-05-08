import { readFile } from "node:fs/promises";
import { normalizeScope } from "../scope.js";

export const DEFAULT_VOICE_MARKERS = [
  /\bvoice note\b/i,
  /\bvoice message\b/i,
  /\btranscribed\b/i,
  /^\s*transcript\s*:/i,
  />\s*\*?"[\s\S]+"\*?\s*$/i,
];

export function scopeFromClaudeHook(input = {}, defaults = {}) {
  const persona = defaults.persona
    ?? process.env.AGENT_BRIDGE_PERSONA
    ?? process.env.CLAUDE_CODE_PERSONA
    ?? "default";
  const session = defaults.session
    ?? input.session_id
    ?? input.sessionId
    ?? input.conversation_id
    ?? input.transcript_path
    ?? input.cwd
    ?? "claude-code-session";
  const channel = defaults.channel ?? process.env.AGENT_SUMMARY_CHANNEL ?? "claude-code";
  const conversation = defaults.conversation ?? process.env.AGENT_SUMMARY_CONVERSATION ?? input.cwd ?? input.transcript_path ?? "";

  return normalizeScope({
    harness: defaults.harness ?? "claude-code",
    persona,
    session,
    channel,
    conversation,
  });
}

export function extractUserPrompt(input = {}) {
  return String(
    input.prompt
      ?? input.message
      ?? input.userPrompt
      ?? input.user_prompt
      ?? input.text
      ?? input.input
      ?? "",
  );
}

export function looksLikeVoicePrompt(text, markers = DEFAULT_VOICE_MARKERS) {
  const value = String(text ?? "");
  return markers.some((marker) => {
    if (marker instanceof RegExp) return marker.test(value);
    return value.toLowerCase().includes(String(marker).toLowerCase());
  });
}

function contentPartToText(part) {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (part.type === "text" && typeof part.value === "string") return part.value;
  return "";
}

export function claudeTranscriptRecordToAssistantMessage(record) {
  if (!record || typeof record !== "object") return null;
  const message = record.message && typeof record.message === "object" ? record.message : record;
  const role = message.role ?? record.role ?? record.type;
  if (role !== "assistant") return null;

  const rawContent = message.content ?? record.content ?? "";
  const text = Array.isArray(rawContent)
    ? rawContent.map(contentPartToText).filter(Boolean).join("\n")
    : contentPartToText(rawContent) || String(rawContent ?? "");

  if (!text.trim()) return null;
  const id = record.uuid ?? record.id ?? message.id ?? `${record.timestamp ?? ""}:${text.slice(0, 80)}`;
  return {
    id,
    messageId: id,
    text,
    timestamp: record.timestamp ?? message.timestamp,
    metadata: {
      claudeHook: true,
      transcriptPath: record.transcript_path,
    },
  };
}

export async function readClaudeAssistantMessages(transcriptPath) {
  if (!transcriptPath) return [];
  const raw = await readFile(transcriptPath, "utf8");
  const messages = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const message = claudeTranscriptRecordToAssistantMessage(parsed);
      if (message) messages.push(message);
    } catch {
      // Ignore malformed transcript lines. Claude hooks must fail open.
    }
  }
  return messages;
}

export async function handleClaudeUserPromptSubmit(engine, input, options = {}) {
  const prompt = extractUserPrompt(input);
  const markers = options.voiceMarkers ?? DEFAULT_VOICE_MARKERS;
  if (!looksLikeVoicePrompt(prompt, markers)) {
    return { recorded: false, ignored: true, reason: "not-voice-note" };
  }

  return engine.recordVoiceNote({
    scope: scopeFromClaudeHook(input, options.scopeDefaults),
    timestamp: input.timestamp,
    messageId: input.message_id ?? input.messageId ?? input.uuid,
    metadata: { claudeHook: "UserPromptSubmit" },
  });
}

export async function handleClaudeStop(engine, input, options = {}) {
  const transcriptPath = options.transcriptPath ?? input.transcript_path ?? input.transcriptPath;
  const scope = scopeFromClaudeHook(input, options.scopeDefaults);
  const messages = await readClaudeAssistantMessages(transcriptPath);
  const results = [];
  for (const message of messages) {
    results.push(await engine.recordAssistantMessage({
      scope,
      timestamp: message.timestamp,
      messageId: message.messageId,
      text: message.text,
      metadata: { ...message.metadata, claudeHook: "Stop" },
    }));
  }
  return { recorded: results.filter((result) => result.recorded).length, results, scope };
}
