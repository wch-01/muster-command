import assert from "node:assert/strict";
import test from "node:test";
import { drawItemAwards, lootItemSummary, normalizeLootItem, parseDiscordLootItems, quantityWarning, resourcePolicyWarning } from "./loot-rules.js";

const item = normalizeLootItem({ name: "Quantanium", category: "RESOURCE", quantity: 5, quality: 85, unit: "boxes" });
const bids = [{ discordUserId: "1", discordTag: "One" }, { discordUserId: "2", discordTag: "Two" }];

void test("validates structured quality and quantity", () => {
  assert.equal(item.quality, 85);
  assert.throws(() => normalizeLootItem({ name: "Bad", quantity: 0 }), /positive whole number/);
  assert.throws(() => normalizeLootItem({ name: "Bad", quality: 1001 }), /1 through 1000/);
  assert.equal(quantityWarning(normalizeLootItem({ name: "Gun", category: "WEAPON", quantity: 11 })), "Unusually large quantity (11). Confirm this is correct before saving.");
});

void test("individual draws distribute before repeating", () => {
  const awards = drawItemAwards(item, bids, "INDIVIDUAL_UNITS", "DIFFERENT_WINNERS", () => 0);
  assert.equal(awards.length, 5);
  assert.deepEqual(awards.map(({ discordUserId }) => discordUserId), ["1", "2", "1", "2", "1"]);
  assert.ok(awards.every((award) => award.quantity === 1));
});

void test("full quantity creates one complete award", () => {
  const awards = drawItemAwards(item, bids, "FULL_QUANTITY", "ALLOW_REPEATS", () => 0.9);
  assert.deepEqual(awards, [{ discordUserId: "2", discordTag: "Two", quantity: 5 }]);
});

void test("Discord shorthand and structured entries share normalization", () => {
  assert.deepEqual(parseDiscordLootItems("Gun, Armor").map((entry) => [entry.name, entry.category, entry.quantity]), [["Gun", "OTHER", 1], ["Armor", "OTHER", 1]]);
  const [structured] = parseDiscordLootItems("resource|Quantanium|10|85|boxes");
  assert.equal(structured.category, "RESOURCE");
  assert.equal(structured.quantity, 10);
  assert.equal(structured.quality, 85);
});

void test("resource policy is guidance and Other retains optional packaging", () => {
  assert.match(resourcePolicyWarning("RESOURCE", "NONE")!, /may still save/);
  const unusual = normalizeLootItem({ name: "Mission crate", category: "OTHER", quantity: 2, quality: 10, unit: "crates" });
  assert.equal(unusual.unit, "crates");
  assert.match(lootItemSummary(unusual, "INDIVIDUAL_UNITS", "DIFFERENT_WINNERS"), /Awarded separately/);
});

void test("mixed pools, repeat winners, and items without bids remain valid", () => {
  const mixed = [
    normalizeLootItem({ name: "Rifle", category: "WEAPON" }),
    normalizeLootItem({ name: "Helmet", category: "ARMOR", quality: "" }),
    normalizeLootItem({ name: "Medpen", category: "CONSUMABLE" }),
  ];
  assert.deepEqual(mixed.map((entry) => entry.category), ["WEAPON", "ARMOR", "CONSUMABLE"]);
  assert.equal(mixed[1].quality, null);
  assert.deepEqual(drawItemAwards(item, [], "INDIVIDUAL_UNITS", "ALLOW_REPEATS"), []);
  const repeated = drawItemAwards({ ...item, quantity: 3 }, bids, "INDIVIDUAL_UNITS", "ALLOW_REPEATS", () => 0);
  assert.deepEqual(repeated.map((award) => award.discordUserId), ["1", "1", "1"]);
});
