import { Client, Events, GatewayIntentBits } from "discord.js";
import { isDiscordConfigured, type DiscordSettings } from "./config.js";
import { prisma } from "./db.js";
import { handleButton } from "./interactions/buttons.js";
import { handleCommand } from "./interactions/commands.js";
import { startLootScheduler } from "./loot/scheduler.js";
import type { AuthenticatedUser } from "./auth.js";

let client: Client | undefined;
let stopScheduler: (() => void) | undefined;
let activeToken: string | undefined;

const withTimeout = async <T>(task: Promise<T>, milliseconds: number) => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

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

export const botGuildMemberProfile = async (guildId: string, user: AuthenticatedUser) => {
  const fallback = {
    guildId,
    userId: user.id,
    displayName: user.globalName ?? user.username,
    nickname: undefined as string | undefined,
    username: user.username,
    avatar: user.avatar,
  };

  if (!client?.isReady()) {
    return fallback;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return fallback;
  }

  const member = await withTimeout(guild.members.fetch(user.id).catch(() => null), 750);
  if (!member) {
    return fallback;
  }

  return {
    guildId,
    userId: user.id,
    displayName: member.displayName || fallback.displayName,
    nickname: member.nickname ?? undefined,
    username: member.user.username,
    avatar: member.displayAvatarURL(),
  };
};

export const botGuildPermissionOptions = async (guildId: string) => {
  if (!client?.isReady()) {
    return { roles: [], users: [], userListAvailable: false };
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return { roles: [], users: [], userListAvailable: false };
  }

  const [fetchedRoles, members] = await Promise.all([
    withTimeout(guild.roles.fetch().catch(() => null), 750),
    withTimeout(guild.members.fetch().catch(() => null), 1_000),
  ]);
  const roles = fetchedRoles
    ? [...fetchedRoles.values()]
        .filter((role) => role.id !== guild.id && !role.managed)
        .map((role) => ({ id: role.id, name: role.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const users = members
    ? [...members.values()]
        .filter((member) => !member.user.bot)
        .map((member) => ({
          id: member.user.id,
          name: member.displayName || member.user.username,
          username: member.user.username,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return { roles, users, userListAvailable: Boolean(members) };
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
