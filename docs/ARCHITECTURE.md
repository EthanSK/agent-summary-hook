# Architecture

`agent-summary-hook` is deliberately split into a harness-neutral state machine and thin harness adapters.

## State machine

The core engine stores one state record per scope:

```txt
harness | persona | session | channel | conversation
```

Examples:

- `openclaw | clordlethird | agent:main:telegram:clordlethird:direct:6164541473 | telegram | 6164541473`
- `claude-code | default | <CLAUDE_CODE_SESSION_ID> | telegram | 6164541473`

That scope key is the main privacy boundary. A default persona and a named persona never share pending message state.

Each scope stores:

- current boundary (`init` or latest `voice` event);
- pending assistant messages since the boundary / last emitted summary;
- bounded `seenAssistantIds` for transcript polling de-duplication;
- last outbound assistant timestamp;
- last summary timestamp and summarized ids.

## Trigger

A summary is due only when all are true:

1. at least 3 pending assistant messages exist;
2. the newest pending assistant message is older than 5 minutes;
3. the pending messages have not already been consumed by a prior summary.

The code uses `idleForMs > idleMs`, not `>=`, to match “more than 5 minutes”.

## Summary output

The deterministic fallback summarizer emits a compact numbered list and wraps it as a Telegram Markdown blockquote:

```txt
> Quiet assistant burst summary (3 messages)
> 1. ...
> 2. ...
> 3. ...
```

Adapters may replace this with an LLM-generated summary later, but they must keep the one-blockquote shape and must call `markSummarySent` only after delivery succeeds.

## No-loop behavior

Summary messages are ignored when either:

- adapter metadata includes `generatedBy: "agent-summary-hook"`;
- the adapter calls `recordAssistantMessage({ isSummary: true })`;
- the visible content starts with the fallback summary heading.

After a summary is sent, the summarized assistant message ids are removed from the pending burst. A repeated checker will therefore not emit a second summary for the same burst.

## OpenClaw path

OpenClaw supports native plugin message hooks:

- `message_received` records voice-note boundaries;
- `message_sent` records assistant messages.

Because idle means “nothing happened for 5 minutes,” delivery should be done from a timer/cron/launchd/systemd checker, not synchronously inside `message_sent`.

## Claude Code path

Claude Code has lifecycle hooks (`UserPromptSubmit`, `Stop`, `SubagentStop`, `SessionStart`, etc.) but not a native assistant-send hook in the inspected local setup. The adapter therefore:

- uses `UserPromptSubmit` to detect voice-note text markers;
- uses `Stop` to parse the transcript JSONL and record newly seen assistant messages;
- relies on the same periodic checker for idle delivery.

This is intentionally documented as a polling/transcript adapter rather than pretending a missing hook exists.

## Public-safety boundaries

The repo must not contain:

- Telegram bot tokens;
- OpenClaw or Claude settings with real secrets;
- session JSONL/transcripts;
- Agent Bridge inbox contents;
- private logs.

State lives outside the repo, defaulting to `~/.agent-summary-hook/state.json`.
