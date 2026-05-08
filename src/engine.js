import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_IDLE_MS, DEFAULT_MIN_MESSAGES, buildTelegramSummary, isSummaryMessage } from "./summary.js";
import { MemoryStore } from "./storage.js";
import { normalizeScope, scopeFromKey, scopeKey } from "./scope.js";

const DEFAULT_MAX_PENDING_MESSAGES = 50;
const DEFAULT_MAX_SEEN_IDS = 500;

function toMillis(value, fallback = Date.now()) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid timestamp: ${value}`);
  return parsed;
}

function stableHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function defaultScopeState(now = Date.now()) {
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    boundary: {
      type: "init",
      at: now,
      eventId: null,
    },
    messages: [],
    seenAssistantIds: [],
    lastOutboundAt: null,
    lastSummaryAt: null,
    lastSummaryMessageIds: [],
  };
}

function ensureScopeState(state, now = Date.now()) {
  const merged = { ...defaultScopeState(now), ...(state ?? {}) };
  merged.boundary = { ...defaultScopeState(now).boundary, ...(state?.boundary ?? {}) };
  merged.messages = Array.isArray(merged.messages) ? merged.messages : [];
  merged.seenAssistantIds = Array.isArray(merged.seenAssistantIds) ? merged.seenAssistantIds : [];
  merged.lastSummaryMessageIds = Array.isArray(merged.lastSummaryMessageIds) ? merged.lastSummaryMessageIds : [];
  return merged;
}

function compactSeenIds(ids, max) {
  if (ids.length <= max) return ids;
  return ids.slice(ids.length - max);
}

function compactMessages(messages, max) {
  if (messages.length <= max) return messages;
  return messages.slice(messages.length - max);
}

export class BurstSummaryEngine {
  constructor(options = {}) {
    this.store = options.store ?? new MemoryStore();
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.minMessages = options.minMessages ?? DEFAULT_MIN_MESSAGES;
    this.maxPendingMessages = options.maxPendingMessages ?? DEFAULT_MAX_PENDING_MESSAGES;
    this.maxSeenIds = options.maxSeenIds ?? DEFAULT_MAX_SEEN_IDS;
  }

  async withDocument(mutator) {
    const document = await this.store.readDocument();
    if (!document.scopes || typeof document.scopes !== "object") document.scopes = {};
    const result = await mutator(document);
    await this.store.writeDocument(document);
    return result;
  }

  async getScopeState(scope) {
    const key = scopeKey(scope);
    const document = await this.store.readDocument();
    return ensureScopeState(document.scopes?.[key]);
  }

  async listScopes() {
    const document = await this.store.readDocument();
    return Object.keys(document.scopes ?? {}).map((key) => ({ key, scope: scopeFromKey(key) }));
  }

  buildAssistantMessageId(message) {
    if (message.messageId) return String(message.messageId);
    if (message.id) return String(message.id);
    return `sha:${stableHash(`${message.timestamp ?? ""}\n${message.text ?? message.content ?? ""}`)}`;
  }

  async recordVoiceNote(event) {
    const scope = normalizeScope(event.scope);
    const key = scopeKey(scope);
    const timestamp = toMillis(event.timestamp ?? event.at);
    const eventId = event.eventId ?? event.messageId ?? event.id ?? `voice:${randomUUID()}`;

    return this.withDocument((document) => {
      const state = ensureScopeState(document.scopes[key], timestamp);
      state.updatedAt = timestamp;
      state.boundary = {
        type: "voice",
        at: timestamp,
        eventId: String(eventId),
      };
      state.messages = [];
      state.lastOutboundAt = null;
      state.lastSummaryAt = null;
      state.lastSummaryMessageIds = [];
      document.scopes[key] = state;
      return { recorded: true, scope, scopeKey: key, state };
    });
  }

  async recordAssistantMessage(event) {
    const scope = normalizeScope(event.scope);
    const key = scopeKey(scope);
    const timestamp = toMillis(event.timestamp ?? event.at);
    const text = String(event.text ?? event.content ?? "");
    const id = this.buildAssistantMessageId({ ...event, timestamp, text });

    if (isSummaryMessage(event)) {
      return { recorded: false, ignored: true, reason: "summary-message", scope, scopeKey: key, id };
    }

    return this.withDocument((document) => {
      const state = ensureScopeState(document.scopes[key], timestamp);
      if (state.seenAssistantIds.includes(id)) {
        document.scopes[key] = state;
        return { recorded: false, ignored: true, reason: "duplicate", scope, scopeKey: key, id, state };
      }

      state.updatedAt = timestamp;
      state.lastOutboundAt = timestamp;
      state.seenAssistantIds = compactSeenIds([...state.seenAssistantIds, id], this.maxSeenIds);
      state.messages = compactMessages([
        ...state.messages,
        {
          id,
          text,
          timestamp,
          metadata: event.metadata ?? {},
        },
      ], this.maxPendingMessages);
      document.scopes[key] = state;
      return { recorded: true, scope, scopeKey: key, id, state };
    });
  }

  async checkIdle(event) {
    const scope = normalizeScope(event.scope);
    const key = scopeKey(scope);
    const now = toMillis(event.now, Date.now());
    const state = await this.getScopeState(scope);
    const messageCount = state.messages.length;
    const lastOutboundAt = state.lastOutboundAt;
    const idleForMs = lastOutboundAt === null || lastOutboundAt === undefined ? 0 : now - lastOutboundAt;
    const due = Boolean(lastOutboundAt && messageCount >= this.minMessages && idleForMs > this.idleMs);
    const summary = due ? buildTelegramSummary(state.messages, event.summaryOptions) : null;

    return {
      due,
      scope,
      scopeKey: key,
      now,
      idleForMs,
      thresholdMs: this.idleMs,
      minMessages: this.minMessages,
      messageCount,
      messages: structuredClone(state.messages),
      summary,
      state,
    };
  }

  async checkAllIdle(event = {}) {
    const scopes = await this.listScopes();
    const results = [];
    for (const { scope } of scopes) {
      results.push(await this.checkIdle({ ...event, scope }));
    }
    return results;
  }

  async markSummarySent(event) {
    const scope = normalizeScope(event.scope);
    const key = scopeKey(scope);
    const timestamp = toMillis(event.timestamp ?? event.at, Date.now());
    const messageIds = new Set((event.messageIds ?? []).map(String));

    return this.withDocument((document) => {
      const state = ensureScopeState(document.scopes[key], timestamp);
      const summarized = messageIds.size > 0
        ? state.messages.filter((message) => messageIds.has(message.id))
        : state.messages;
      state.messages = messageIds.size > 0
        ? state.messages.filter((message) => !messageIds.has(message.id))
        : [];
      state.updatedAt = timestamp;
      state.lastSummaryAt = timestamp;
      state.lastSummaryMessageIds = summarized.map((message) => message.id);
      document.scopes[key] = state;
      return {
        recorded: true,
        scope,
        scopeKey: key,
        summarizedCount: summarized.length,
        state,
      };
    });
  }

  async consumeDueSummary(event) {
    const due = await this.checkIdle(event);
    if (!due.due) return due;
    await this.markSummarySent({
      scope: due.scope,
      timestamp: event.now ?? Date.now(),
      messageIds: due.messages.map((message) => message.id),
    });
    return { ...due, consumed: true };
  }
}

export { DEFAULT_IDLE_MS, DEFAULT_MIN_MESSAGES };
