import type { Client, MessageCreateOptions, TextBasedChannel } from "discord.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { lootComponents, lootEmbed, lootReportEmbed } from "./loot-views.js";

export const lootInclude = {
  items: {
    orderBy: { sortOrder: "asc" },
    include: {
      bids: {
        orderBy: { createdAt: "asc" },
      },
    },
  },
} satisfies Prisma.LootRaffleInclude;

export type RaffleWithItems = Prisma.LootRaffleGetPayload<{ include: typeof lootInclude }>;

export const getRaffle = (lootId: string) => {
  return prisma.lootRaffle.findUnique({
    where: { id: lootId },
    include: lootInclude,
  });
};

export const getRaffleByEventId = (eventId: string) => {
  return prisma.lootRaffle.findFirst({
    where: { eventId },
    orderBy: { createdAt: "asc" },
    include: lootInclude,
  });
};

export const addLootItems = async (
  eventId: string,
  items: string[],
  addedBy: { id: string; name: string },
) => {
  return prisma.$transaction(async (tx) => {
    const raffle = await tx.lootRaffle.findFirst({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      include: lootInclude,
    });

    if (!raffle) {
      return null;
    }

    if (raffle.status !== "OPEN") {
      throw new Error("That loot pool has already been drawn.");
    }

    const availableSlots = Math.max(25 - raffle.items.length, 0);
    const itemsToAdd = items.slice(0, availableSlots);

    if (!itemsToAdd.length) {
      throw new Error("That loot pool already has the maximum 25 items.");
    }

    await tx.lootItem.createMany({
      data: itemsToAdd.map((name, index) => ({
        eventId,
        lootRaffleId: raffle.id,
        name,
        addedById: addedBy.id,
        addedByName: addedBy.name,
        sortOrder: raffle.items.length + index,
      })),
    });

    return tx.lootRaffle.findFirst({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      include: lootInclude,
    });
  });
};

export const drawRaffle = async (lootId: string) => {
  return prisma.$transaction(async (tx) => {
    const raffle = await tx.lootRaffle.findUnique({
      where: { id: lootId },
      include: lootInclude,
    });

    if (!raffle || raffle.status === "DRAWN") {
      return raffle;
    }

    for (const item of raffle.items) {
      if (!item.bids.length) {
        continue;
      }

      const winner = item.bids[Math.floor(Math.random() * item.bids.length)];
      await tx.lootItem.update({
        where: { id: item.id },
        data: {
          winnerUserId: winner.discordUserId,
          winnerTag: winner.discordTag,
        },
      });
    }

    return tx.lootRaffle.update({
      where: { id: lootId },
      data: { status: "DRAWN" },
      include: lootInclude,
    });
  });
};

export const drawRaffleByEventId = async (eventId: string) => {
  const raffle = await getRaffleByEventId(eventId);
  return raffle ? drawRaffle(raffle.id) : null;
};

export const publishRaffleUpdate = async (client: Client, raffle: RaffleWithItems) => {
  if (!raffle.channelId) {
    return;
  }
  const channel = await client.channels.fetch(raffle.channelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    return;
  }

  let didUpdateMessage = false;
  if (raffle.messageId) {
    const message = await channel.messages.fetch(raffle.messageId).catch(() => null);
    if (message) {
      await message.edit({ embeds: [lootEmbed(raffle)], components: lootComponents(raffle) });
      didUpdateMessage = true;
    }
  }

  if (!didUpdateMessage) {
    const message = await channel.send({
      embeds: [lootEmbed(raffle)],
      components: lootComponents(raffle),
    });

    await prisma.lootRaffle.update({
      where: { id: raffle.id },
      data: { messageId: message.id },
    });
  }

  if (raffle.status === "DRAWN") {
    await postLootReport(channel, raffle);
  }
};

export const publishRaffleReplacement = async (
  client: Client,
  raffle: RaffleWithItems,
  addedItems: string[],
) => {
  if (!raffle.channelId) {
    return;
  }
  const channel = await client.channels.fetch(raffle.channelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    return;
  }

  if (raffle.messageId) {
    const oldMessage = await channel.messages.fetch(raffle.messageId).catch(() => null);
    if (oldMessage) {
      const itemText =
        addedItems.length === 1
          ? `Added item: ${addedItems[0]}`
          : `Added items: ${addedItems.join(", ")}`;

      await oldMessage.edit({
        embeds: [
          lootEmbed(raffle).setFooter({
            text: `${itemText}. A newer bidding panel was posted below.`,
          }),
        ],
        components: [],
      });
    }
  }

  const newMessage = await channel.send({
    embeds: [lootEmbed(raffle)],
    components: lootComponents(raffle),
  });

  await prisma.lootRaffle.update({
    where: { id: raffle.id },
    data: { messageId: newMessage.id },
  });
};

export const publishFreshRafflePanel = async (client: Client, raffle: RaffleWithItems) => {
  if (!raffle.channelId) {
    return;
  }
  const channel = await client.channels.fetch(raffle.channelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    return;
  }

  if (raffle.messageId) {
    const oldMessage = await channel.messages.fetch(raffle.messageId).catch(() => null);
    if (oldMessage) {
      await oldMessage.edit({
        embeds: [
          lootEmbed(raffle).setFooter({
            text: "A newer bidding panel was posted below.",
          }),
        ],
        components: [],
      });
    }
  }

  const newMessage = await channel.send({
    embeds: [lootEmbed(raffle)],
    components: lootComponents(raffle),
  });

  await prisma.lootRaffle.update({
    where: { id: raffle.id },
    data: { messageId: newMessage.id },
  });
};

export const postLootReport = async (channel: TextBasedChannel, raffle: RaffleWithItems) => {
  if ("send" in channel) {
    await channel.send({ embeds: [lootReportEmbed(raffle)] } satisfies MessageCreateOptions);
  }
};
