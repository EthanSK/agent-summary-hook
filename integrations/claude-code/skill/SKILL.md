---
name: agent-summary-hook-claude-code
summary: Install/operate the Claude Code side of agent-summary-hook burst summaries.
---

# Agent Summary Hook — Claude Code skill

Use this when Ethan asks to install, verify, or debug the Claude Code equivalent of the OpenClaw burst-summary hook.

## Reality check

Claude Code hooks can run at lifecycle points such as `UserPromptSubmit` and `Stop`, but there is no reliable dedicated `assistant_message_sent` hook in the local Claude Code setup. The practical adapter is therefore:

- `UserPromptSubmit`: detect voice-note/transcript markers and reset the burst boundary.
- `Stop`: read the Claude transcript JSONL and record any new assistant messages by stable id.
- periodic checker: after the session has been quiet for >5 minutes, run `agent-summary-hook send-due --all ...`.

## Commands

```bash
# Hook command bodies used by the plugin adapter:
agent-summary-hook claude-user-prompt < hook-input.json
agent-summary-hook claude-stop < hook-input.json

# Timer/checker command:
agent-summary-hook send-due --all --sender telegram-bot
# or, if OpenClaw should deliver the message:
agent-summary-hook send-due --all --sender openclaw
```

## Safety

- Do not paste Claude transcript JSONL into chat.
- Do not commit `.claude/settings.json`, hook state, Telegram tokens, or transcripts.
- If a loop happens, remove/disable the periodic checker first; the recording hooks are fail-open and low risk.
