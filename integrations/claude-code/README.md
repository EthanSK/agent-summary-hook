# Claude Code integration

Claude Code has hook support via `settings.json` and plugin `hooks/hooks.json` files. The local machine already uses hooks such as `SessionStart`, `Stop`, and `SubagentStop`.

For Ethan's burst-summary behavior, the honest mapping is:

- **Voice boundary:** `UserPromptSubmit` hook scans the submitted prompt for voice-note/transcript markers and resets the boundary.
- **Assistant messages:** `Stop` hook reads the transcript JSONL path supplied by Claude Code and records any new assistant messages by stable id.
- **Idle gate:** a periodic checker runs later. Claude Code's Stop hook fires immediately when the assistant finishes, so it cannot itself prove that 5+ minutes of silence passed.

## Files here

- `plugin/` — Claude Code plugin-style hook adapter (`.claude-plugin/plugin.json` plus `hooks/hooks.json`).
- `skill/SKILL.md` — reusable install/debug skill.

## Example user settings snippet

If you do not install this as a Claude plugin, the equivalent direct `~/.claude/settings.json` snippet is:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/ethansk/Projects/agent-summary-hook/bin/agent-summary-hook.js claude-user-prompt",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/ethansk/Projects/agent-summary-hook/bin/agent-summary-hook.js claude-stop",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Do not blindly overwrite an existing `settings.json`; merge with existing hooks.

## Periodic checker examples

Default stdout dry run:

```bash
AGENT_SUMMARY_STATE="$HOME/.agent-summary-hook/state.json" \
agent-summary-hook send-due --all --sender stdout
```

Telegram Bot API delivery needs external secrets in environment, never in git:

```bash
AGENT_SUMMARY_STATE="$HOME/.agent-summary-hook/state.json" \
AGENT_SUMMARY_TELEGRAM_BOT_TOKEN="..." \
AGENT_SUMMARY_TELEGRAM_CHAT_ID="..." \
agent-summary-hook send-due --all --sender telegram-bot --format html
```

If OpenClaw is the delivery surface on the same machine, make sure Claude-recorded scopes use the Telegram channel/target (for example by setting `AGENT_SUMMARY_CHANNEL=telegram` and `AGENT_SUMMARY_CONVERSATION=<chat-id>` in the hook environment), or pass an explicit target:

```bash
AGENT_SUMMARY_STATE="$HOME/.agent-summary-hook/state.json" \
agent-summary-hook send-due --all --sender openclaw --channel telegram --target <chat-id>
```

## Voice marker limitations

Claude Code does not inherently know that a prompt came from a Telegram/WhatsApp voice note. The adapter uses text markers such as `voice note`, `voice message`, `transcribed`, and `Transcript:`. If a Telegram plugin writes richer metadata into the transcript later, add a detector rather than guessing.
