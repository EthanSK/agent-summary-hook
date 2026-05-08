const REQUIRED_SCOPE_FIELDS = ["harness", "persona", "session", "channel"];

function cleanPart(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function normalizeScope(scope, defaults = {}) {
  const merged = { ...defaults, ...(scope ?? {}) };
  const normalized = {
    harness: cleanPart(merged.harness),
    persona: cleanPart(merged.persona),
    session: cleanPart(merged.session),
    channel: cleanPart(merged.channel),
    conversation: cleanPart(merged.conversation ?? merged.conversationId ?? merged.target ?? ""),
  };

  const missing = REQUIRED_SCOPE_FIELDS.filter((field) => !normalized[field]);
  if (missing.length > 0) {
    throw new Error(`Scope is missing required field(s): ${missing.join(", ")}`);
  }

  return normalized;
}

export function encodeScopePart(value) {
  return encodeURIComponent(String(value ?? ""));
}

export function decodeScopePart(value) {
  return decodeURIComponent(String(value ?? ""));
}

export function scopeKey(scope) {
  const normalized = normalizeScope(scope);
  return [
    normalized.harness,
    normalized.persona,
    normalized.session,
    normalized.channel,
    normalized.conversation,
  ].map(encodeScopePart).join("|");
}

export function scopeFromKey(key) {
  const [harness, persona, session, channel, conversation = ""] = String(key).split("|").map(decodeScopePart);
  return normalizeScope({ harness, persona, session, channel, conversation });
}

export function parseScope(value) {
  if (typeof value === "object" && value !== null) return normalizeScope(value);
  if (!value) throw new Error("Missing --scope JSON");

  const raw = String(value).trim();
  if (raw.startsWith("{")) return normalizeScope(JSON.parse(raw));

  const parts = raw.split("|");
  if (parts.length >= 4) {
    return normalizeScope({
      harness: parts[0],
      persona: parts[1],
      session: parts[2],
      channel: parts[3],
      conversation: parts.slice(4).join("|"),
    });
  }

  throw new Error("--scope must be JSON or harness|persona|session|channel|conversation");
}
