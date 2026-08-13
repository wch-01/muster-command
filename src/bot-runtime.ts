import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { isDiscordConfigured, type DiscordSettings } from "./config.js";
import { prisma } from "./db.js";
import { handleButton } from "./interactions/buttons.js";
import { handleCommand } from "./interactions/commands.js";
import { startLootScheduler } from "./loot/scheduler.js";
import { getRaffleByEventId, publishRaffleUpdate } from "./loot/loot-service.js";
import { eventInclude } from "./events/event-service.js";
import { eventComponents, eventEmbed } from "./events/event-views.js";
import type { AuthenticatedUser } from "./auth.js";
import { loadSettings } from "./settings-store.js";

let client: Client | undefined;
let stopScheduler: (() => void) | undefined;
let activeToken: string | undefined;
let connectedAt: number | undefined;

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

export const botStatus = () => ({
  configured: Boolean(activeToken),
  connected: Boolean(client?.isReady()),
  userTag: client?.isReady() ? client.user.tag : undefined,
  userId: client?.isReady() ? client.user.id : undefined,
  guildCount: client?.isReady() ? client.guilds.cache.size : 0,
  uptimeSeconds: client?.isReady() && connectedAt ? Math.floor((Date.now() - connectedAt) / 1000) : undefined,
});

export const botGuilds = () => {
  if (!client?.isReady()) {
    return [];
  }

  return client.guilds.cache.map((guild) => ({
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconURL({ size: 64 }) ?? undefined,
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

const outputChannelTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

export const botGuildTextChannels = async (guildId: string) => {
  const readyClient = client;
  if (!readyClient?.isReady() || !readyClient.user) {
    return [];
  }

  const guild = readyClient.guilds.cache.get(guildId);
  if (!guild) {
    return [];
  }

  const fetchedChannels = await withTimeout(guild.channels.fetch().catch(() => null), 1_500);
  const channels = fetchedChannels ?? guild.channels.cache;

  const availableChannels: Array<{ id: string; name: string; type: string }> = [];
  for (const channel of channels.values()) {
    if (!channel || !outputChannelTypes.has(channel.type)) {
      continue;
    }

    const permissions = channel.permissionsFor(guild.members.me ?? readyClient.user.id);
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions.has(PermissionFlagsBits.SendMessages)
    ) {
      continue;
    }

    availableChannels.push({
      id: channel.id,
      name: channel.name,
      type: ChannelType[channel.type] ?? String(channel.type),
    });
  }

  return availableChannels.sort((a, b) => a.name.localeCompare(b.name));
};

export const publishEventPanel = async (eventId: string) => {
  const settings = await loadSettings();
  if (!settings.discordEventPublishingEnabled) {
    return false;
  }

  const readyClient = client;
  if (!readyClient?.isReady()) {
    throw new Error("The Discord bot is not connected.");
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: eventInclude });
  if (!event) {
    throw new Error("Event not found.");
  }

  let destinationId = event.channelId;
  if (!destinationId) {
    const configuredChannelId = settings.eventOutputChannelId;
    if (!configuredChannelId) {
      throw new Error("No event output channel is configured.");
    }

    const configuredChannel = await readyClient.channels.fetch(configuredChannelId);
    if (
      !configuredChannel ||
      (configuredChannel.type !== ChannelType.GuildText &&
        configuredChannel.type !== ChannelType.GuildAnnouncement)
    ) {
      throw new Error("The configured event output channel is not available.");
    }

    if (settings.eventOutputMode === "thread") {
      const cleanupDays = settings.threadAutoDeleteDays ?? 7;
      const autoArchiveDuration =
        cleanupDays <= 1
          ? ThreadAutoArchiveDuration.OneDay
          : cleanupDays <= 3
            ? ThreadAutoArchiveDuration.ThreeDays
            : ThreadAutoArchiveDuration.OneWeek;
      const thread = await configuredChannel.threads.create({
        name: event.name.slice(0, 100),
        autoArchiveDuration,
        reason: `Muster Command event ${event.id}`,
      });
      destinationId = thread.id;
    } else {
      destinationId = configuredChannel.id;
    }

    const lootDestinationId =
      settings.eventOutputMode === "thread"
        ? destinationId
        : settings.lootOutputChannelId || destinationId;
    await prisma.$transaction([
      prisma.event.update({ where: { id: event.id }, data: { channelId: destinationId } }),
      prisma.lootRaffle.updateMany({
        where: { eventId: event.id },
        data: { channelId: lootDestinationId },
      }),
    ]);
  }

  const channel = await readyClient.channels.fetch(destinationId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error("The selected Discord channel is not available.");
  }

  if (event.messageId) {
    const existing = await channel.messages.fetch(event.messageId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [eventEmbed(event)], components: eventComponents(event) });
      return true;
    }
  }

  const message = await channel.send({ embeds: [eventEmbed(event)], components: eventComponents(event) });
  await prisma.event.update({ where: { id: event.id }, data: { messageId: message.id } });
  return true;
};

export const publishLootPanel = async (eventId: string) => {
  const settings = await loadSettings();
  if (!settings.discordEventPublishingEnabled) {
    return false;
  }

  const readyClient = client;
  if (!readyClient?.isReady()) {
    throw new Error("The Discord bot is not connected.");
  }

  let raffle = await getRaffleByEventId(eventId);
  if (raffle && !raffle.channelId) {
    await publishEventPanel(eventId);
    raffle = await getRaffleByEventId(eventId);
  }
  if (raffle) {
    await publishRaffleUpdate(readyClient, raffle);
  }
  return Boolean(raffle);
};

export const stopBot = async () => {
  stopScheduler?.();
  stopScheduler = undefined;
  await client?.destroy();
  client = undefined;
  activeToken = undefined;
  connectedAt = undefined;
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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  nextClient.once(Events.ClientReady, (readyClient) => {
    connectedAt = Date.now();
    console.log(`Logged in as ${readyClient.user.tag}.`);
    stopScheduler = startLootScheduler(readyClient);
  });

  nextClient.on(Events.InteractionCreate, (interaction) => {
    void (async () => {
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

        if (error && typeof error === "object" && "code" in error && error.code === 40060) {
          console.warn("Another bot instance already acknowledged this Discord interaction.");
          return;
        }

        const content = "Something went wrong while handling that interaction.";
        if (interaction.isRepliable()) {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content, ephemeral: true });
          } else {
            await interaction.reply({ content, ephemeral: true });
          }
        }
      }
    })();
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
