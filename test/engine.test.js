import test from "node:test";
import assert from "node:assert/strict";
import { BurstSummaryEngine, MemoryStore } from "../src/index.js";

const scope = {
  harness: "openclaw",
  persona: "clordlethird",
  session: "agent:main:telegram:clordlethird:direct:6164541473",
  channel: "telegram",
  conversation: "6164541473",
};

const otherScope = {
  ...scope,
  persona: "default",
  session: "agent:main:telegram:default:direct:6164541473",
};

function at(minutes, seconds = 0) {
  return Date.UTC(2026, 4, 8, 21, minutes, seconds);
}

async function recordMessages(engine, targetScope = scope, count = 3, startMinute = 0) {
  for (let index = 0; index < count; index += 1) {
    await engine.recordAssistantMessage({
      scope: targetScope,
      messageId: `m-${targetScope.persona}-${startMinute}-${index}`,
      timestamp: at(startMinute + index),
      text: `Assistant follow-up ${index + 1}`,
    });
  }
}

test("does not summarize before 3 assistant messages", async () => {
  const engine = new BurstSummaryEngine({ store: new MemoryStore() });
  await engine.recordVoiceNote({ scope, messageId: "voice-1", timestamp: at(0) });
  await recordMessages(engine, scope, 2, 1);

  const result = await engine.checkIdle({ scope, now: at(8) });
  assert.equal(result.due, false);
  assert.equal(result.messageCount, 2);
});

test("requires more than the five minute idle gate", async () => {
  const engine = new BurstSummaryEngine({ store: new MemoryStore() });
  await engine.recordVoiceNote({ scope, messageId: "voice-1", timestamp: at(0) });
  await recordMessages(engine, scope, 3, 1); // last outbound at 21:03

  const justUnder = await engine.checkIdle({ scope, now: Date.UTC(2026, 4, 8, 21, 7, 59) });
  assert.equal(justUnder.due, false);

  const over = await engine.checkIdle({ scope, now: Date.UTC(2026, 4, 8, 21, 8, 1) });
  assert.equal(over.due, true);
  assert.match(over.summary.markdown, /^> Quiet assistant burst summary \(3 messages\)/);
});

test("voice-note boundary resets pending assistant messages", async () => {
  const engine = new BurstSummaryEngine({ store: new MemoryStore() });
  await recordMessages(engine, scope, 2, 1);
  await engine.recordVoiceNote({ scope, messageId: "voice-2", timestamp: at(4) });
  await recordMessages(engine, scope, 2, 5);

  const result = await engine.checkIdle({ scope, now: at(12) });
  assert.equal(result.due, false);
  assert.equal(result.messageCount, 2);
  assert.deepEqual(result.messages.map((message) => message.text), ["Assistant follow-up 1", "Assistant follow-up 2"]);
});

test("consumeDueSummary emits once and summary messages do not count", async () => {
  const engine = new BurstSummaryEngine({ store: new MemoryStore() });
  await engine.recordVoiceNote({ scope, messageId: "voice-1", timestamp: at(0) });
  await recordMessages(engine, scope, 3, 1);

  const first = await engine.consumeDueSummary({ scope, now: at(9) });
  assert.equal(first.due, true);
  assert.equal(first.consumed, true);

  const loopRecord = await engine.recordAssistantMessage({
    scope,
    messageId: "summary-1",
    timestamp: at(9, 1),
    text: first.summary.markdown,
  });
  assert.equal(loopRecord.ignored, true);

  const second = await engine.checkIdle({ scope, now: at(20) });
  assert.equal(second.due, false);
  assert.equal(second.messageCount, 0);
});

test("scope isolation prevents cross-persona leakage", async () => {
  const engine = new BurstSummaryEngine({ store: new MemoryStore() });
  await engine.recordVoiceNote({ scope, messageId: "voice-1", timestamp: at(0) });
  await engine.recordVoiceNote({ scope: otherScope, messageId: "voice-2", timestamp: at(0) });
  await recordMessages(engine, scope, 3, 1);
  await recordMessages(engine, otherScope, 2, 1);

  const clordle = await engine.checkIdle({ scope, now: at(9) });
  const defaultPersona = await engine.checkIdle({ scope: otherScope, now: at(9) });

  assert.equal(clordle.due, true);
  assert.equal(defaultPersona.due, false);
  assert.equal(defaultPersona.messageCount, 2);
});

test("duplicate assistant message ids are ignored for transcript polling", async () => {
  const engine = new BurstSummaryEngine({ store: new MemoryStore() });
  await engine.recordVoiceNote({ scope, messageId: "voice-1", timestamp: at(0) });
  const first = await engine.recordAssistantMessage({ scope, messageId: "same", timestamp: at(1), text: "First" });
  const duplicate = await engine.recordAssistantMessage({ scope, messageId: "same", timestamp: at(2), text: "First again" });

  assert.equal(first.recorded, true);
  assert.equal(duplicate.ignored, true);
  const state = await engine.getScopeState(scope);
  assert.equal(state.messages.length, 1);
});
