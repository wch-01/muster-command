import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { type SlotPresetName, parseCustomSlots, slotPresets } from "../slot-presets.js";

export const eventInclude = {
  slots: {
    orderBy: { sortOrder: "asc" },
    include: {
      assignments: {
        orderBy: { createdAt: "asc" },
      },
    },
  },
} satisfies Prisma.EventInclude;

export type EventWithSlots = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

export const getEvent = (eventId: string) => {
  return prisma.event.findUnique({
    where: { id: eventId },
    include: eventInclude,
  });
};

export const createEvent = async (input: {
  guildId: string;
  channelId: string;
  reportChannelId?: string;
  createdById: string;
  name: string;
  startsAt?: Date;
  lootDurationHours: number;
  preset: SlotPresetName | "custom";
  customSlots?: string;
}) => {
  const seeds =
    input.preset === "custom"
      ? parseCustomSlots(input.customSlots ?? "")
      : slotPresets[input.preset];

  if (!seeds.length) {
    throw new Error("At least one crew slot is required.");
  }

  return prisma.event.create({
    data: {
      guildId: input.guildId,
      channelId: input.channelId,
      reportChannelId: input.reportChannelId,
      createdById: input.createdById,
      name: input.name,
      startsAt: input.startsAt,
      lootDurationHours: input.lootDurationHours,
      slots: {
        create: seeds.map((seed, index) => ({
          category: seed.category,
          assignmentGroup: seed.assignmentGroup,
          label: seed.label,
          capacity: seed.capacity,
          sortOrder: index,
        })),
      },
      raffles: {
        create: {
          channelId: input.channelId,
          createdById: input.createdById,
          name: `Loot pool: ${input.name}`,
        },
      },
    },
    include: eventInclude,
  });
};

export const endEvent = async (eventId: string) => {
  const endedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.update({
      where: { id: eventId },
      data: { status: "CLOSED", endedAt },
      include: eventInclude,
    });

    await tx.lootRaffle.updateMany({
      where: { eventId },
      data: {
        endsAt: new Date(endedAt.getTime() + event.lootDurationHours * 60 * 60 * 1000),
      },
    });

    return event;
  });
};
