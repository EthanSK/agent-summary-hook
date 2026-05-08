import { BurstSummaryEngine, JsonFileStore, defaultStatePath } from "agent-summary-hook";
import {
  handleOpenClawMessageReceived,
  handleOpenClawMessageSent,
} from "agent-summary-hook/adapters/openclaw";

const engine = new BurstSummaryEngine({
  store: new JsonFileStore(process.env.AGENT_SUMMARY_STATE ?? defaultStatePath(process.env)),
});

export default async function handler(event: any) {
  if (event?.type !== "message") return;

  const context = event.context ?? {};
  const payload = context.event ?? context.message ?? context;
  const ctx = context.ctx ?? context.hookContext ?? {
    sessionKey: event.sessionKey,
    messageProvider: payload.channel ?? payload.provider,
    channelId: payload.to ?? payload.from ?? payload.threadId,
    accountId: payload.accountId,
  };

  if (event.action === "received") {
    await handleOpenClawMessageReceived(engine, payload, ctx);
  }

  if (event.action === "sent") {
    await handleOpenClawMessageSent(engine, payload, ctx);
  }
}
