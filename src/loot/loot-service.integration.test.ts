import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../db.js";
import { addLootItems, drawRaffle, updateLootItem } from "./loot-service.js";

const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

void integrationTest("preserves bids through edits and creates award records on draw", async () => {
  const event = await prisma.event.create({
    data: {
      guildId: "phase-5-integration-guild", createdById: "owner", createdByName: "Owner",
      name: "Phase 5 temporary integration event", lootAwardMethod: "INDIVIDUAL_UNITS",
      lootRepeatWinnerMode: "DIFFERENT_WINNERS",
      raffles: { create: { createdById: "owner", name: "Temporary loot" } },
    },
  });

  try {
    const raffle = await addLootItems(event.id, [{
      name: "Quantanium", category: "RESOURCE", quantity: 3, quality: 85, unit: "boxes",
    }], { id: "creator", name: "Creator" });
    const item = raffle!.items[0];
    await prisma.lootBid.createMany({ data: [
      { lootItemId: item.id, discordUserId: "one", discordTag: "One" },
      { lootItemId: item.id, discordUserId: "two", discordTag: "Two" },
    ] });

    await assert.rejects(updateLootItem(item.id, "stranger", { ...item, name: "Nope" } as never), /item creator or event owner/);
    await updateLootItem(item.id, "creator", {
      name: "Refined Quantanium", category: "RESOURCE", quantity: 3, quality: 90, unit: "boxes",
    });
    assert.equal(await prisma.lootBid.count({ where: { lootItemId: item.id } }), 2);

    const drawn = await drawRaffle(raffle!.id);
    assert.equal(drawn!.status, "DRAWN");
    assert.equal(drawn!.automaticDrawEnabled, false);
    assert.equal(drawn!.endsAt, null);
    assert.equal(drawn!.items[0].awards.reduce((total, award) => total + award.quantity, 0), 3);
    await assert.rejects(updateLootItem(item.id, "owner", {
      name: "Too late", category: "OTHER", quantity: 1, quality: null, unit: null,
    }), /after the pool is drawn/);
  } finally {
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.$disconnect();
  }
});
