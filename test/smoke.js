import assert from "node:assert/strict";
import { BurstSummaryEngine, MemoryStore } from "../src/index.js";

const scope = {
  harness: "smoke",
  persona: "default",
  session: "session-1",
  channel: "telegram",
  conversation: "chat-1",
};

const engine = new BurstSummaryEngine({ store: new MemoryStore() });
await engine.recordVoiceNote({ scope, messageId: "voice", timestamp: "2026-05-08T21:00:00Z" });
for (let i = 0; i < 3; i += 1) {
  await engine.recordAssistantMessage({
    scope,
    messageId: `assistant-${i}`,
    timestamp: `2026-05-08T21:0${i + 1}:00Z`,
    text: `Smoke assistant message ${i + 1}`,
  });
}
const due = await engine.consumeDueSummary({ scope, now: "2026-05-08T21:08:01Z" });
assert.equal(due.due, true);
assert.match(due.summary.markdown, /^> Quiet assistant burst summary/);
const again = await engine.checkIdle({ scope, now: "2026-05-08T21:20:00Z" });
assert.equal(again.due, false);
console.log("smoke ok");
