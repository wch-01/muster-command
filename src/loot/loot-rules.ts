export const lootCategories = ["RESOURCE", "WEAPON", "ARMOR", "COMPONENT", "CONSUMABLE", "OTHER"] as const;
export type LootCategory = (typeof lootCategories)[number];
export type AwardMethod = "FULL_QUANTITY" | "INDIVIDUAL_UNITS";
export type RepeatWinnerMode = "ALLOW_REPEATS" | "DIFFERENT_WINNERS";
export type ResourceLootPolicy = "ANY" | "REFINED_ONLY" | "RAW_ONLY" | "NONE" | "CUSTOM";

export type LootItemInput = {
  name: string;
  category: LootCategory;
  quantity: number;
  quality: number | null;
  unit: string | null;
};

const oneOf = <T extends readonly string[]>(value: unknown, choices: T, fallback: T[number]): T[number] =>
  typeof value === "string" && choices.includes(value as T[number]) ? value as T[number] : fallback;

export const normalizeLootItem = (value: unknown): LootItemInput => {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("Loot item name is required.");
  if (name.length > 120) throw new Error("Loot item names must be 120 characters or fewer.");

  const quantity = Number(input.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`${name}: quantity must be a positive whole number.`);
  const quality = input.quality === null || input.quality === undefined || input.quality === "" ? null : Number(input.quality);
  if (quality !== null && (!Number.isInteger(quality) || quality < 1 || quality > 1000)) {
    throw new Error(`${name}: quality must be a whole number from 1 through 1000.`);
  }

  const category = oneOf(input.category, lootCategories, "OTHER");
  const unit = typeof input.unit === "string" && input.unit.trim() ? input.unit.trim().slice(0, 80) : null;
  return {
    name,
    category,
    quantity,
    quality,
    unit: category === "RESOURCE" || category === "OTHER" ? unit : null,
  };
};

export const effectiveAwardMethod = (eventDefault: string): AwardMethod =>
  eventDefault === "INDIVIDUAL_UNITS" ? "INDIVIDUAL_UNITS" : "FULL_QUANTITY";

export const effectiveRepeatWinnerMode = (eventDefault: string): RepeatWinnerMode =>
  eventDefault === "ALLOW_REPEATS" ? "ALLOW_REPEATS" : "DIFFERENT_WINNERS";

export const quantityWarning = (item: Pick<LootItemInput, "category" | "quantity">) => {
  const threshold = item.category === "RESOURCE" ? 100 : 10;
  return item.quantity > threshold ? `Unusually large quantity (${item.quantity}). Confirm this is correct before saving.` : null;
};

export const resourcePolicyWarning = (category: LootCategory, policy: string) =>
  category === "RESOURCE" && policy === "NONE" ? "This event asks participants not to add resources. You may still save this item." : null;

export const lootItemSummary = (item: LootItemInput, eventAward: string, eventRepeats: string) => {
  const parts = [item.name];
  if (item.quality) parts.push(`Quality ${item.quality}`);
  parts.push(item.unit ? `${item.quantity} ${item.unit}` : `Quantity ${item.quantity}`);
  const award = effectiveAwardMethod(eventAward);
  if (award === "FULL_QUANTITY") parts.push("Entire entry awarded to one winner");
  else {
    parts.push("Awarded separately");
    if (effectiveRepeatWinnerMode(eventRepeats) === "DIFFERENT_WINNERS") {
      parts.push(`Up to one ${item.unit ?? "unit"} per bidder before repeats`);
    }
  }
  return parts.join(" · ");
};

export type DrawBid = { discordUserId: string; discordTag: string };
export type DrawAward = DrawBid & { quantity: number };

export const drawItemAwards = (
  item: LootItemInput,
  bids: DrawBid[],
  eventAward: string,
  eventRepeats: string,
  random: () => number = Math.random,
): DrawAward[] => {
  if (!bids.length) return [];
  if (effectiveAwardMethod(eventAward) === "FULL_QUANTITY") {
    const winner = bids[Math.floor(random() * bids.length)];
    return [{ ...winner, quantity: item.quantity }];
  }

  const awards: DrawAward[] = [];
  let available = [...bids];
  const different = effectiveRepeatWinnerMode(eventRepeats) === "DIFFERENT_WINNERS";
  for (let unit = 0; unit < item.quantity; unit += 1) {
    if (!available.length) available = [...bids];
    const index = Math.floor(random() * available.length);
    const winner = available[index];
    awards.push({ ...winner, quantity: 1 });
    if (different) available.splice(index, 1);
  }
  return awards;
};

const categoryAliases: Record<string, LootCategory> = {
  resource: "RESOURCE", material: "RESOURCE", weapon: "WEAPON", armor: "ARMOR",
  component: "COMPONENT", equipment: "COMPONENT", consumable: "CONSUMABLE", other: "OTHER",
};

export const parseDiscordLootItems = (text: string): LootItemInput[] => {
  if (!text.includes("|")) {
    return text.split(",").map((name) => name.trim()).filter(Boolean).map((name) => normalizeLootItem({ name, category: "OTHER" }));
  }
  return text.split(";").map((entry) => {
    const [categoryText, name, quantity, quality, unit] = entry.split("|").map((part) => part.trim());
    return normalizeLootItem({
      category: categoryAliases[categoryText.toLowerCase()] ?? categoryText.toUpperCase(), name,
      quantity: quantity || 1, quality: quality || null, unit: unit || null,
    });
  });
};
