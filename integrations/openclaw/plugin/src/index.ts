import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { BurstSummaryEngine, JsonFileStore, defaultStatePath } from "agent-summary-hook";
import {
  handleOpenClawMessageReceived,
  handleOpenClawMessageSent,
  openClawCliSender,
  sendSummaryIfDue,
} from "agent-summary-hook/adapters/openclaw";

function getPluginConfig(api: any) {
  const cfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
  return {
    enabled: cfg.enabled !== false,
    sendFromGatewayTimer: cfg.sendFromGatewayTimer === true,
    checkEveryMs: Number(cfg.checkEveryMs ?? 60_000),
    statePath: typeof cfg.statePath === "string" ? cfg.statePath : defaultStatePath(process.env),
    openclawBin: typeof cfg.openclawBin === "string" ? cfg.openclawBin : "openclaw",
  };
}

export default definePluginEntry({
  id: "agent-summary-hook",
  name: "Agent Summary Hook",
  description: "Records assistant message bursts and summarizes quiet bursts.",
  register(api) {
    const cfg = getPluginConfig(api);
    if (!cfg.enabled) return;

    const engine = new BurstSummaryEngine({ store: new JsonFileStore(cfg.statePath) });

    api.on("message_received", async (event, ctx) => {
      await handleOpenClawMessageReceived(engine, event, ctx);
    }, { priority: -50, timeoutMs: 5_000 });

    api.on("message_sent", async (event, ctx) => {
      await handleOpenClawMessageSent(engine, event, ctx);
    }, { priority: -50, timeoutMs: 5_000 });

    // Honest practical path: OpenClaw's message hooks run at receive/send time;
    // the 5-minute idle gate needs a later wake. For a production install, prefer
    // OpenClaw cron or an external launchd/systemd timer that calls:
    //   agent-summary-hook send-due --all --sender openclaw
    // This optional timer is here for local experiments only.
    if (cfg.sendFromGatewayTimer) {
      const timer = setInterval(async () => {
        const scopes = await engine.listScopes();
        for (const { scope } of scopes) {
          try {
            await sendSummaryIfDue(
              engine,
              scope,
              openClawCliSender({ bin: cfg.openclawBin, channel: scope.channel, target: scope.conversation }),
            );
          } catch (error) {
            api.logger.warn(`agent-summary-hook send check failed: ${String(error)}`);
          }
        }
      }, cfg.checkEveryMs);
      timer.unref?.();

      api.registerRuntimeLifecycle({
        id: "agent-summary-hook-timer",
        description: "Clears the experimental burst-summary checker interval.",
        cleanup() {
          clearInterval(timer);
        },
      });
    }
  },
});
