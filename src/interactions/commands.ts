import {
  ChannelType,
  EmbedBuilder,
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
import type { SlotPresetName } from "../slot-presets.js";

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
      name: interaction.options.getString("name", true),
      description: interaction.options.getString("description") ?? undefined,
      logoUrl: interaction.options.getString("logo_url") ?? undefined,
      startsAt: parseStartDate(interaction.options.getString("starts_at")),
      lootDurationHours: interaction.options.getInteger("loot_timelimit", true),
      preset,
      customSlots: interaction.options.getString("custom_slots") ?? undefined,
    });

    await interaction.editReply({
      embeds: [eventEmbed(event)],
      components: eventComponents(event),
    });
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
    const items = interaction.options
      .getString("items", true)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

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

    const raffle = await addLootItems(eventId, items);
    if (!raffle) {
      await interaction.editReply("I could not find a loot pool for that event ID.");
      return;
    }

    await publishRaffleReplacement(interaction.client, raffle, items);
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
  if (interaction.commandName === "event") {
    await handleEventCommand(interaction);
    return;
  }

  if (interaction.commandName === "loot") {
    await handleLootCommand(interaction);
  }
};
