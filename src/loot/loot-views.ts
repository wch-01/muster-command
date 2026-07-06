import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbedField,
} from "discord.js";
import type { LootBid, LootItem, LootRaffle } from "@prisma/client";
import { lootBidId } from "../custom-ids.js";

type RaffleWithItems = LootRaffle & {
  items: Array<LootItem & { bids: LootBid[] }>;
};

export const lootEmbed = (raffle: RaffleWithItems) => {
  const fields: APIEmbedField[] = raffle.items.map((item) => ({
    name: item.name,
    value:
      raffle.status === "DRAWN"
        ? item.winnerTag
          ? `Winner: ${item.winnerTag}`
          : "No eligible bids."
        : `Bids: ${item.bids.length}`,
    inline: true,
  }));

  return new EmbedBuilder()
    .setTitle(raffle.name)
    .setDescription(
      [
        `Event ID: \`${raffle.eventId}\``,
        raffle.status === "OPEN" && raffle.endsAt
          ? `Bids close: <t:${Math.floor(raffle.endsAt.getTime() / 1000)}:R>`
          : null,
        raffle.status === "OPEN" && !raffle.endsAt
          ? "Bids close after the event is ended and the loot timer expires."
          : null,
        raffle.status === "DRAWN" ? "Status: DRAWN" : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .setColor(raffle.status === "OPEN" ? 0x8b5cf6 : 0xf59e0b)
    .addFields(fields)
    .setTimestamp(raffle.updatedAt);
};

export const lootComponents = (raffle: RaffleWithItems) => {
  const buttons = raffle.items.slice(0, 25).map((item) =>
    new ButtonBuilder()
      .setCustomId(lootBidId(item.id))
      .setLabel(item.name.slice(0, 80))
      .setStyle(ButtonStyle.Success)
      .setDisabled(raffle.status !== "OPEN"),
  );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
  }

  return rows;
};

export const lootReportEmbed = (raffle: RaffleWithItems) => {
  return new EmbedBuilder()
    .setTitle(`Loot results: ${raffle.name}`)
    .setDescription(`Event ID: \`${raffle.eventId}\``)
    .setColor(0xf59e0b)
    .addFields(
      raffle.items.map((item) => ({
        name: item.name,
        value: item.winnerTag ? `Winner: ${item.winnerTag}` : "No eligible bids.",
        inline: true,
      })),
    )
    .setTimestamp();
};
