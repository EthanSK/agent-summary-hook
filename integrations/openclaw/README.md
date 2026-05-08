# OpenClaw integration

OpenClaw is the easier harness because it exposes native message hooks:

- `message_received` can observe inbound channel events and voice-note/transcript metadata.
- `message_sent` can observe outbound assistant deliveries.

The catch: those hooks only run **when a message event happens**. Ethan's trigger requires a summary after **no new assistant message** has been sent for more than 5 minutes, so a later wake is still required. The practical install is therefore:

1. a plugin or internal hook that records receive/send events;
2. a periodic checker that runs every minute or so and calls `agent-summary-hook send-due --all --sender openclaw`.

## Files here

- `plugin/` — reference OpenClaw plugin adapter using `api.on("message_received")` and `api.on("message_sent")`.
- `internal-hook/` — smaller internal hook adapter for `~/.openclaw/hooks/agent-summary-hook/`.
- `skill/SKILL.md` — reusable operator skill instructions.

## Public-safe setup sketch

```bash
cd /Users/ethansk/Projects/agent-summary-hook
npm test
npm link

# Example state path; keep this out of git.
export AGENT_SUMMARY_STATE="$HOME/.agent-summary-hook/state.json"

# Recording can happen via the plugin/internal hook adapter.
# Delivery should happen from a timer/cron, not inline inside message_sent:
agent-summary-hook send-due --all --sender openclaw
```

## OpenClaw config shape

A native plugin install would add an entry resembling:

```json5
{
  plugins: {
    entries: {
      "agent-summary-hook": {
        enabled: true,
        path: "/Users/ethansk/Projects/agent-summary-hook/integrations/openclaw/plugin",
        config: {
          enabled: true,
          statePath: "/Users/ethansk/.agent-summary-hook/state.json",
          sendFromGatewayTimer: false
        }
      }
    }
  }
}
```

Do not apply that blindly on a live machine without checking the current OpenClaw plugin install mechanism and whether a gateway restart/hot reload is required.

## Why not send directly from the send hook?

Sending directly from `message_sent` would check too early — the assistant has just sent something, so the idle period has not elapsed. It also increases loop risk. The package detects its own summary text and metadata, but the cleaner production pattern is still: record inline, send from a separate checker.
