import { isDiscordConfigured } from "./config.js";
import { shutdownBotRuntime, startBot } from "./bot-runtime.js";
import { loadSettings } from "./settings-store.js";
import { startSetupServer } from "./setup-server.js";
import { ensureActivityGroupBackfill } from "./events/group-backfill.js";

// TODO: Move loot into a separate channel for cleaner channel views.
// TODO: Create a new thread for each event, then delete that thread one week after the event ends.

const shutdown = async () => {
  await shutdownBotRuntime();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

const settings = await loadSettings();
await ensureActivityGroupBackfill();
await startSetupServer();

if (isDiscordConfigured(settings)) {
  await startBot(settings);
} else {
  console.log("Discord credentials are not configured yet. Open the setup page to add them.");
}
