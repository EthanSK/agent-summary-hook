import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BurstSummaryEngine, MemoryStore } from "../src/index.js";
import { handleClaudeStop, handleClaudeUserPromptSubmit } from "../src/adapters/claude-code.js";

const scopeDefaults = {
  persona: "default",
  channel: "telegram",
  conversation: "6164541473",
};

test("Claude UserPromptSubmit can reset on a voice-note marker", async () => {
  const engine = new BurstSummaryEngine({ store: new MemoryStore() });
  const result = await handleClaudeUserPromptSubmit(engine, {
    session_id: "claude-session-1",
    prompt: "Voice note transcript: please do the thing",
    timestamp: "2026-05-08T21:00:00Z",
  }, { scopeDefaults });

  assert.equal(result.recorded, true);
  const state = await engine.getScopeState({ harness: "claude-code", session: "claude-session-1", ...scopeDefaults });
  assert.equal(state.boundary.type, "voice");
});

test("Claude Stop adapter records assistant messages from JSONL transcript once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-summary-hook-"));
  const transcript = join(dir, "session.jsonl");
  await writeFile(transcript, [
    JSON.stringify({ uuid: "u1", timestamp: "2026-05-08T21:01:00Z", message: { role: "assistant", content: [{ type: "text", text: "First" }] } }),
    JSON.stringify({ uuid: "u2", timestamp: "2026-05-08T21:02:00Z", type: "user", message: { role: "user", content: "Ignored" } }),
    JSON.stringify({ uuid: "u3", timestamp: "2026-05-08T21:03:00Z", message: { role: "assistant", content: "Second" } }),
  ].join("\n"));

  const engine = new BurstSummaryEngine({ store: new MemoryStore() });
  const input = { session_id: "claude-session-2", transcript_path: transcript };
  const first = await handleClaudeStop(engine, input, { scopeDefaults });
  const second = await handleClaudeStop(engine, input, { scopeDefaults });

  assert.equal(first.recorded, 2);
  assert.equal(second.recorded, 0);
});
