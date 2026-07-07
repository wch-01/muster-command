import { Client, Events, GatewayIntentBits } from "discord.js";
import { isDiscordConfigured, type DiscordSettings } from "./config.js";
import { prisma } from "./db.js";
import { handleButton } from "./interactions/buttons.js";
import { handleCommand } from "./interactions/commands.js";
import { startLootScheduler } from "./loot/scheduler.js";

let client: Client | undefined;
let stopScheduler: (() => void) | undefined;
let activeToken: string | undefined;

export const botStatus = (settings?: DiscordSettings) => ({
  configured: Boolean(activeToken),
  connected: Boolean(client?.isReady()),
  userTag: client?.isReady() ? client.user.tag : undefined,
  guildCount: client?.isReady() ? client.guilds.cache.size : 0,
  inConfiguredGuild:
    client?.isReady() && settings?.discordGuildId
      ? client.guilds.cache.has(settings.discordGuildId)
      : undefined,
});

export const botGuilds = () => {
  if (!client?.isReady()) {
    return [];
  }

  return client.guilds.cache.map((guild) => ({
    id: guild.id,
    name: guild.name,
  }));
};

export const stopBot = async () => {
  stopScheduler?.();
  stopScheduler = undefined;
  client?.destroy();
  client = undefined;
  activeToken = undefined;
};

export const startBot = async (settings: DiscordSettings) => {
  if (!isDiscordConfigured(settings)) {
    await stopBot();
    return { started: false, message: "Discord token and client ID are not configured yet." };
  }

  if (client?.isReady() && activeToken === settings.discordToken) {
    return { started: true, message: `Bot is already connected as ${client.user.tag}.` };
  }

  await stopBot();

  const nextClient = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  nextClient.once(Events.ClientReady, (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}.`);
    stopScheduler = startLootScheduler(readyClient);
  });

  nextClient.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction);
      }
    } catch (error) {
      console.error(error);

      const content = "Something went wrong while handling that interaction.";
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content, ephemeral: true });
        } else {
          await interaction.reply({ content, ephemeral: true });
        }
      }
    }
  });

  await nextClient.login(settings.discordToken);
  client = nextClient;
  activeToken = settings.discordToken;

  return { started: true, message: "Bot connection started." };
};

export const shutdownBotRuntime = async () => {
  await stopBot();
  await prisma.$disconnect();
};
