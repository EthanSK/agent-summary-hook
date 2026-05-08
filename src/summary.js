export const DEFAULT_IDLE_MS = 5 * 60 * 1000;
export const DEFAULT_MIN_MESSAGES = 3;
export const SUMMARY_METADATA_FLAG = "agent-summary-hook";

export function isSummaryMessage(input = {}) {
  const metadata = input.metadata ?? {};
  const content = String(input.text ?? input.content ?? "").trim();
  if (input.isSummary === true) return true;
  if (input.generatedBy === SUMMARY_METADATA_FLAG) return true;
  if (metadata.generatedBy === SUMMARY_METADATA_FLAG) return true;
  if (metadata.agentSummaryHook === true) return true;
  if (metadata.summaryHook === SUMMARY_METADATA_FLAG) return true;
  if (/^(>|<blockquote>)\s*Quiet assistant burst summary/i.test(content)) return true;
  return false;
}

export function normalizeMessageText(text, maxChars = 280) {
  const compact = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function summarizeMessages(messages, options = {}) {
  const count = messages.length;
  const title = options.title ?? `Quiet assistant burst summary (${count} messages)`;
  const maxMessages = options.maxMessages ?? 8;
  const maxChars = options.maxCharsPerMessage ?? 240;
  const visible = messages.slice(-maxMessages);
  const hiddenCount = Math.max(0, count - visible.length);
  const lines = [title];

  if (hiddenCount > 0) {
    lines.push(`Earlier ${hiddenCount} message${hiddenCount === 1 ? "" : "s"} omitted from this compact view.`);
  }

  for (const [index, message] of visible.entries()) {
    const text = normalizeMessageText(message.text ?? message.content ?? "", maxChars);
    if (!text) continue;
    lines.push(`${index + 1}. ${text}`);
  }

  if (lines.length === 1) lines.push("The assistant sent follow-up messages, but their text was empty or unavailable.");
  return lines.join("\n");
}

export function telegramMarkdownBlockquote(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function telegramHtmlBlockquote(text) {
  return `<blockquote>${escapeHtml(text)}</blockquote>`;
}

export function buildTelegramSummary(messages, options = {}) {
  const plain = summarizeMessages(messages, options);
  return {
    plain,
    markdown: telegramMarkdownBlockquote(plain),
    html: telegramHtmlBlockquote(plain),
  };
}
