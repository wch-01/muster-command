import type { Client } from "discord.js";
import { prisma } from "../db.js";
import { drawRaffle, publishRaffleUpdate } from "./loot-service.js";

export const startLootScheduler = (client: Client<true>) => {
  const check = async () => {
    const due = await prisma.lootRaffle.findMany({
      where: {
        status: "OPEN",
        endsAt: { lte: new Date() },
      },
      select: { id: true },
      take: 10,
    });

    for (const raffle of due) {
      const drawn = await drawRaffle(raffle.id);
      if (drawn) {
        await publishRaffleUpdate(client, drawn);
      }
    }
  };

  const interval = setInterval(() => {
    void check().catch((error) => console.error("Loot scheduler failed", error));
  }, 60_000);

  void check().catch((error) => console.error("Loot scheduler failed", error));

  return () => clearInterval(interval);
};
