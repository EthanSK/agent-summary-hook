# agent-summary-hook

Cross-harness assistant burst summaries for OpenClaw and Claude Code.

The package models Ethan's requested trigger:

- reset the burst boundary when a voice note is observed;
- record outbound assistant messages per harness/persona/session/channel;
- after **more than 5 minutes** of outbound-message silence, if **3 or more** assistant messages were sent since the last boundary, create exactly one Telegram blockquote summary;
- ignore the generated summary message so it cannot start a loop;
- keep state scoped so one persona/session/channel cannot leak into another.

This repo is intentionally small and public-safe: no tokens, no transcripts, no local config.

## Install for local development

```bash
npm install
npm test
```

No runtime dependencies are required. Node 22+ is expected because that is what the current OpenClaw/Claude Code machines use.

## CLI quick start

```bash
SCOPE='{"harness":"openclaw","persona":"clordlethird","session":"agent:main:telegram:clordlethird:direct:6164541473","channel":"telegram","conversation":"6164541473"}'

agent-summary-hook record-voice --scope "$SCOPE" --id voice-1 --at 2026-05-08T21:00:00Z
agent-summary-hook record-assistant --scope "$SCOPE" --id a1 --at 2026-05-08T21:00:10Z --text "First follow-up."
agent-summary-hook record-assistant --scope "$SCOPE" --id a2 --at 2026-05-08T21:01:00Z --text "Second follow-up."
agent-summary-hook record-assistant --scope "$SCOPE" --id a3 --at 2026-05-08T21:02:00Z --text "Third follow-up."
agent-summary-hook check --scope "$SCOPE" --now 2026-05-08T21:07:01Z
```

By default state is written to `~/.agent-summary-hook/state.json`. Override with `AGENT_SUMMARY_STATE=/path/to/state.json`.

## Harness integrations

- OpenClaw: see [`integrations/openclaw/README.md`](integrations/openclaw/README.md).
- Claude Code: see [`integrations/claude-code/README.md`](integrations/claude-code/README.md).
- Architecture and caveats: see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Important caveat

OpenClaw has native `message_received` / `message_sent` plugin hooks. Claude Code currently has useful lifecycle hooks (`UserPromptSubmit`, `Stop`, etc.) but not a dedicated “assistant message sent” hook. The Claude Code adapter therefore records assistant turns from the transcript at `Stop` and relies on a periodic checker (cron/launchd/systemd, or an OpenClaw/Agent Bridge supervisor) to evaluate the 5-minute idle gate.
