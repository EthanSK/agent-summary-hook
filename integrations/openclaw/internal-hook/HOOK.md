---
name: agent-summary-hook
summary: Record OpenClaw message send/receive events for burst summaries
version: 0.1.0
events:
  - message:received
  - message:sent
requirements:
  binaries:
    - node
---

# Agent Summary Hook internal adapter

This is a lightweight OpenClaw internal-hook adapter. It records events into `agent-summary-hook` state only.

For actually delivering summaries after the 5-minute idle gate, run a periodic checker separately:

```bash
agent-summary-hook send-due --all --sender openclaw
```

That split is deliberate: internal hooks run when a message event happens, but the useful summary must fire **after no message happens** for more than 5 minutes.
