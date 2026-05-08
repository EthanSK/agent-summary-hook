export { BurstSummaryEngine, DEFAULT_IDLE_MS, DEFAULT_MIN_MESSAGES } from "./engine.js";
export { JsonFileStore, MemoryStore, defaultStatePath } from "./storage.js";
export { normalizeScope, parseScope, scopeFromKey, scopeKey } from "./scope.js";
export {
  SUMMARY_METADATA_FLAG,
  buildTelegramSummary,
  isSummaryMessage,
  normalizeMessageText,
  summarizeMessages,
  telegramHtmlBlockquote,
  telegramMarkdownBlockquote,
} from "./summary.js";
