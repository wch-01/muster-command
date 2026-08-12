import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIEmbedField,
} from "discord.js";
import type { Event, LootAward, LootBid, LootItem, LootRaffle } from "@prisma/client";
import { lootBidId } from "../custom-ids.js";
import { lootItemSummary } from "./loot-rules.js";

type RaffleWithItems = LootRaffle & {
  event: Event;
  items: Array<LootItem & { bids: LootBid[]; awards: LootAward[] }>;
};

const awardText = (item: RaffleWithItems["items"][number]) => {
  if (!item.awards.length) return "No eligible bids.";
  const totals = new Map<string, { tag: string; quantity: number }>();
  for (const award of item.awards) {
    const current = totals.get(award.discordUserId);
    totals.set(award.discordUserId, { tag: award.discordTag, quantity: (current?.quantity ?? 0) + award.quantity });
  }
  return [...totals.values()].map((award) => `${award.tag}: ${award.quantity}`).join("\n");
};

const policyLabels: Record<string, string> = {
  ANY: "Any form", REFINED_ONLY: "Refined materials only", RAW_ONLY: "Raw resources only",
  NONE: "No resources", CUSTOM: "Custom rules",
};

export const lootEmbed = (raffle: RaffleWithItems) => {
  const fields: APIEmbedField[] = raffle.items.map((item) => ({
    name: lootItemSummary(item as never, raffle.event.lootAwardMethod, raffle.event.lootRepeatWinnerMode).slice(0, 256),
    value:
      raffle.status === "DRAWN"
        ? awardText(item)
        : `Bids: ${item.bids.length}`,
    inline: true,
  }));

  return new EmbedBuilder()
    .setTitle(raffle.name)
    .setDescription(
      [
        `Event ID: \`${raffle.eventId}\``,
        `Resource loot rules: **${policyLabels[raffle.event.resourceLootPolicy] ?? "Any form"}**`,
        raffle.event.resourceInstructions ? `Resource instructions: ${raffle.event.resourceInstructions}` : null,
        raffle.event.lootInstructions ? `Loot instructions: ${raffle.event.lootInstructions}` : null,
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
        name: lootItemSummary(item as never, raffle.event.lootAwardMethod, raffle.event.lootRepeatWinnerMode).slice(0, 256),
        value: awardText(item),
        inline: true,
      })),
    )
    .setTimestamp();
};
