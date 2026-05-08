---
name: agent-summary-hook-openclaw
summary: Install/operate the OpenClaw side of agent-summary-hook burst summaries.
---

# Agent Summary Hook — OpenClaw skill

Use this when Ethan asks to install, verify, or debug the OpenClaw burst-summary hook.

## Core behavior

- Scope state by `harness/persona/session/channel/conversation`.
- Treat inbound voice notes/transcripts as the boundary reset.
- Record assistant `message_sent` events.
- After >5 minutes idle and >=3 recorded assistant messages, send one Telegram blockquote summary.
- Do not count the summary message itself.

## Recommended install path

OpenClaw has native message hooks, but the idle trigger needs a later wake. Use both:

1. Install a hook/plugin adapter to record `message_received` and `message_sent`.
2. Add a low-frequency OpenClaw cron/launchd/systemd checker that runs:

```bash
AGENT_SUMMARY_STATE="$HOME/.agent-summary-hook/state.json" \
agent-summary-hook send-due --all --sender openclaw
```

## Safety

- Never paste raw session JSONL/transcripts into chat.
- Never commit tokens, bot IDs, or private message logs.
- If delivery loops, disable the checker first; recording alone is safe.
