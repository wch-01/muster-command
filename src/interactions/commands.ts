import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type MessageCreateOptions,
} from "discord.js";
import { prisma } from "../db.js";
import { createEvent, endEvent, eventInclude } from "../events/event-service.js";
import { eventComponents, eventEmbed, eventReportEmbed } from "../events/event-views.js";
import {
  addLootItems,
  drawRaffleByEventId,
  getRaffleByEventId,
  publishFreshRafflePanel,
  publishRaffleReplacement,
  publishRaffleUpdate,
} from "../loot/loot-service.js";
import { lootComponents, lootEmbed, lootReportEmbed } from "../loot/loot-views.js";
import { parseDiscordLootItems } from "../loot/loot-rules.js";
import type { SlotPresetName } from "../slot-presets.js";
import { loadSettings } from "../settings-store.js";
import { commandAccessForGuild, memberCommandTier, tierAllowsCapability, type CommandCapability } from "../command-access.js";

const parseStartDate = (input: string | null) => {
  if (!input) {
    return undefined;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("I could not read that start time. Try `2026-07-10 20:00 UTC`.");
  }

  return parsed;
};

const displayName = (interaction: ChatInputCommandInteraction) => {
  return interaction.member && "displayName" in interaction.member
    ? interaction.member.displayName
    : interaction.user.globalName ?? interaction.user.username;
};

const websitePathForCommand = (interaction: ChatInputCommandInteraction, capability: CommandCapability) => {
  if (capability === "event.create") return "/app/events";
  if (capability === "event.list") return "/app/active-events";
  const eventId = interaction.options.getString("event_id");
  if (eventId && capability.startsWith("loot.")) return `/app/events/${encodeURIComponent(eventId)}?loot=1`;
  if (eventId) return `/app/events/${encodeURIComponent(eventId)}`;
  return "/app";
};

const websiteLink = (baseUrl: string | undefined, path: string) => {
  if (!baseUrl) return undefined;
  try {
    return new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString();
  } catch {
    return undefined;
  }
};

const sendReport = async (
  interaction: ChatInputCommandInteraction,
  reportChannelId: string | null,
  embed: EmbedBuilder,
) => {
  const channel = reportChannelId
    ? await interaction.client.channels.fetch(reportChannelId)
    : interaction.channel;

  if (!channel?.isTextBased() || !("send" in channel)) {
    await interaction.followUp({
      content: "The report channel was not available, so I could not post the report.",
      ephemeral: true,
    });
    return;
  }

  await channel.send({ embeds: [embed] } satisfies MessageCreateOptions);
};

const handleEventCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({ content: "Events can only be used inside a server.", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "create") {
    await interaction.deferReply();

    const preset = interaction.options.getString("preset", true) as SlotPresetName | "custom";
    const reportChannel = interaction.options.getChannel("report_channel", false, [
      ChannelType.GuildText,
    ]);

    const event = await createEvent({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      reportChannelId: reportChannel?.id,
      createdById: interaction.user.id,
      createdByName: displayName(interaction),
      name: interaction.options.getString("name", true),
      description: interaction.options.getString("description") ?? undefined,
      logoUrl: interaction.options.getString("logo_url") ?? undefined,
      startsAt: parseStartDate(interaction.options.getString("starts_at")),
      lootDurationHours: interaction.options.getInteger("loot_timelimit", true),
      preset,
      customSlots: interaction.options.getString("custom_slots") ?? undefined,
    });

    const message = await interaction.editReply({
      embeds: [eventEmbed(event)],
      components: eventComponents(event),
    });
    await prisma.event.update({ where: { id: event.id }, data: { messageId: message.id } });
    return;
  }

  if (subcommand === "list") {
    const events = await prisma.event.findMany({
      where: {
        guildId: interaction.guildId,
        status: "OPEN",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: eventInclude,
    });

    const embed = new EmbedBuilder()
      .setTitle("Open events")
      .setColor(0x2f8f6f)
      .setDescription(
        events.length
          ? events
              .map((event) => {
                const assigned = event.slots.reduce(
                  (total, slot) => total + slot.assignments.length,
                  0,
                );
                return `\`${event.id}\` - ${event.name} (${assigned} signed up)`;
              })
              .join("\n")
          : "No open events yet.",
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === "end") {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.options.getString("event_id", true);
    const existingEvent = await prisma.event.findUnique({ where: { id: eventId } });
    if (!existingEvent) {
      await interaction.editReply("I could not find an event with that ID.");
      return;
    }
    const event = await endEvent(eventId);
    const raffle = await getRaffleByEventId(eventId);

    await sendReport(interaction, event.reportChannelId, eventReportEmbed(event));
    if (raffle) {
      await publishRaffleUpdate(interaction.client, raffle);
    }

    await interaction.editReply(
      `Ended \`${event.name}\`, posted the attendance report, and started the ${event.lootDurationHours}-hour loot timer.`,
    );
  }
};

const handleLootCommand = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({ content: "Loot rolls can only be used inside a server.", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "draw") {
    await interaction.deferReply();

    const eventId = interaction.options.getString("event_id", true);
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      await interaction.editReply("I could not find an event with that ID.");
      return;
    }
    const existingRaffle = await getRaffleByEventId(eventId);
    if (existingRaffle?.status === "DRAWN") {
      await interaction.editReply("This loot pool has already been drawn.");
      return;
    }
    const raffle = await drawRaffleByEventId(eventId);
    if (!raffle) {
      await interaction.editReply("I could not find a loot pool for that event ID.");
      return;
    }

    await interaction.editReply({
      embeds: [lootEmbed(raffle)],
      components: lootComponents(raffle),
    });
    await sendReport(interaction, raffle.channelId, lootReportEmbed(raffle));
    return;
  }

  if (subcommand === "add") {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.options.getString("event_id", true);
    let items;
    try {
      items = parseDiscordLootItems(interaction.options.getString("items", true));
    } catch (error) {
      await interaction.editReply(error instanceof Error ? error.message : "I could not read those loot items.");
      return;
    }

    if (!items.length) {
      await interaction.editReply("Add at least one loot item.");
      return;
    }

    const participant = await prisma.crewAssignment.findFirst({
      where: {
        eventId,
        discordUserId: interaction.user.id,
      },
    });

    if (!participant) {
      await interaction.editReply("Only event participants can add items to this loot pool.");
      return;
    }

    const raffle = await addLootItems(eventId, items, {
      id: interaction.user.id,
      name: displayName(interaction),
    });
    if (!raffle) {
      await interaction.editReply("I could not find a loot pool for that event ID.");
      return;
    }

    await publishRaffleReplacement(interaction.client, raffle, items.map((item) => item.name));
    await interaction.editReply(`Updated \`${raffle.name}\` with the added loot items.`);
    return;
  }

  if (subcommand === "show") {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.options.getString("event_id", true);
    const raffle = await getRaffleByEventId(eventId);
    if (!raffle) {
      await interaction.editReply("I could not find a loot pool for that event ID.");
      return;
    }

    await publishFreshRafflePanel(interaction.client, raffle);
    await interaction.editReply(`Posted the current loot pool for \`${raffle.name}\`.`);
  }
};

export const handleCommand = async (interaction: ChatInputCommandInteraction) => {
  if (interaction.commandName !== "mc") return;

  const group = interaction.options.getSubcommandGroup(true);
  const subcommand = interaction.options.getSubcommand(true);
  const capability = `${group}.${subcommand}` as CommandCapability;
  const isAdministrator = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  const memberRoles = interaction.member && "roles" in interaction.member
    ? Array.isArray(interaction.member.roles)
      ? interaction.member.roles
      : [...interaction.member.roles.cache.keys()]
    : [];
  const settings = await loadSettings();
  const guildAccess = commandAccessForGuild(settings.commandAccessByGuild, interaction.guildId ?? "");
  const tier = memberCommandTier(memberRoles, guildAccess);

  if (!isAdministrator && !tierAllowsCapability(tier, capability, guildAccess)) {
    const destination = websiteLink(settings.publicAppUrl, websitePathForCommand(interaction, capability));
    await interaction.reply({
      content: destination
        ? `This slash command is not available to your Discord role. Continue on the [Muster Command website](${destination}), or ask a server administrator for command access.`
        : "This slash command is not available to your Discord role. Continue on the Muster Command website, or ask a server administrator for command access. Administrators: save the Public Website URL in System Admin to include a direct link here.",
      ephemeral: true,
    });
    return;
  }

  if (group === "event") {
    await handleEventCommand(interaction);
    return;
  }

  if (group === "loot") {
    await handleLootCommand(interaction);
  }
};
