import type { ButtonInteraction } from "discord.js";
import { prisma } from "../db.js";
import { parseCustomId } from "../custom-ids.js";
import { getEvent } from "../events/event-service.js";
import { eventComponents, eventEmbed } from "../events/event-views.js";
import { getRaffle } from "../loot/loot-service.js";
import { lootComponents, lootEmbed } from "../loot/loot-views.js";

const displayName = (interaction: ButtonInteraction) => {
  return interaction.member && "displayName" in interaction.member
    ? interaction.member.displayName
    : interaction.user.username;
};

const handleEventJoin = async (interaction: ButtonInteraction, slotId: string) => {
  const slot = await prisma.crewSlot.findUnique({
    where: { id: slotId },
    include: { event: true },
  });

  if (!slot || slot.event.status !== "OPEN") {
    await interaction.reply({ content: "That signup slot is no longer open.", ephemeral: true });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.crewAssignment.deleteMany({
      where: {
        eventId: slot.eventId,
        discordUserId: interaction.user.id,
        assignmentGroup: slot.assignmentGroup,
      },
    });

    const taken = await tx.crewAssignment.count({ where: { crewSlotId: slot.id } });
    if (taken >= slot.capacity) {
      throw new Error("That slot filled up just before you clicked it.");
    }

    await tx.crewAssignment.create({
      data: {
        eventId: slot.eventId,
        crewSlotId: slot.id,
        assignmentGroup: slot.assignmentGroup,
        discordUserId: interaction.user.id,
        discordTag: displayName(interaction),
      },
    });
  });

  const event = await getEvent(slot.eventId);
  if (!event) {
    await interaction.reply({ content: "The event could not be found.", ephemeral: true });
    return;
  }

  await interaction.update({ embeds: [eventEmbed(event)], components: eventComponents(event) });
};

const handleEventLeave = async (interaction: ButtonInteraction, eventId: string) => {
  await prisma.crewAssignment.deleteMany({
    where: {
      eventId,
      discordUserId: interaction.user.id,
    },
  });

  const event = await getEvent(eventId);
  if (!event) {
    await interaction.reply({ content: "The event could not be found.", ephemeral: true });
    return;
  }

  await interaction.update({ embeds: [eventEmbed(event)], components: eventComponents(event) });
};

const handleEventCopy = async (interaction: ButtonInteraction, eventId: string) => {
  await interaction.reply({
    content: `Event ID:\n\`\`\`text\n${eventId}\n\`\`\``,
    ephemeral: true,
  });
};

const handleLootBid = async (interaction: ButtonInteraction, itemId: string) => {
  const item = await prisma.lootItem.findUnique({
    where: { id: itemId },
    include: {
      raffle: true,
    },
  });

  if (!item || item.raffle.status !== "OPEN") {
    await interaction.reply({ content: "That loot roll is no longer open.", ephemeral: true });
    return;
  }

  const participant = await prisma.crewAssignment.findFirst({
    where: {
      eventId: item.raffle.eventId,
      discordUserId: interaction.user.id,
    },
  });

  if (!participant) {
    await interaction.reply({
      content: "Sorry, you did not participate in that event, so you cannot enter this roll.",
      ephemeral: true,
    });
    return;
  }

  const existing = await prisma.lootBid.findUnique({
    where: {
      lootItemId_discordUserId: {
        lootItemId: itemId,
        discordUserId: interaction.user.id,
      },
    },
  });

  if (existing) {
    await prisma.lootBid.delete({ where: { id: existing.id } });
  } else {
    await prisma.lootBid.create({
      data: {
        lootItemId: itemId,
        discordUserId: interaction.user.id,
        discordTag: displayName(interaction),
      },
    });
  }

  const message = existing
    ? `Removed your bid for **${item.name}**.`
    : `Added your bid for **${item.name}**.`;

  const raffle = await getRaffle(item.raffle.id);
  if (!raffle) {
    await interaction.reply({ content: "The loot roll could not be found.", ephemeral: true });
    return;
  }

  await interaction.update({ embeds: [lootEmbed(raffle)], components: lootComponents(raffle) });
  await interaction.followUp({ content: message, ephemeral: true });
};

export const handleButton = async (interaction: ButtonInteraction) => {
  const { scope, action, id } = parseCustomId(interaction.customId);
  if (!id) {
    await interaction.reply({ content: "That button is not recognized.", ephemeral: true });
    return;
  }

  try {
    if (scope === "event" && action === "join") {
      await handleEventJoin(interaction, id);
      return;
    }

    if (scope === "event" && action === "leave") {
      await handleEventLeave(interaction, id);
      return;
    }

    if (scope === "event" && action === "copy") {
      await handleEventCopy(interaction, id);
      return;
    }

    if (scope === "loot" && action === "bid") {
      await handleLootBid(interaction, id);
      return;
    }

    await interaction.reply({ content: "That button is not recognized.", ephemeral: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "That button could not be handled.";
    await interaction.reply({ content: message, ephemeral: true });
  }
};
