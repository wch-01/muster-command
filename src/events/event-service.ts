import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { type SlotPresetName, parseCustomSlots, slotPresets } from "../slot-presets.js";
import { activityGroupsFromSlots, type ActivityGroupSeed } from "../event-groups.js";

export const eventInclude = {
  groups: {
    orderBy: { sortOrder: "asc" },
  },
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
  channelId?: string;
  reportChannelId?: string;
  createdById: string;
  createdByName: string;
  name: string;
  description?: string;
  logoUrl?: string;
  startsAt?: Date;
  lootDurationHours: number;
  preset: SlotPresetName | "custom";
  customSlots?: string;
  groups?: ActivityGroupSeed[];
  extraCrewCapacity?: number;
}) => {
  const seeds =
    input.preset === "custom"
      ? parseCustomSlots(input.customSlots ?? "")
      : slotPresets[input.preset];

  const groups = input.groups ?? activityGroupsFromSlots(seeds, Boolean(input.startsAt));
  const extraSlots = seeds.filter((seed) => seed.assignmentGroup === "extra");
  if (!groups.length && !extraSlots.length && !input.extraCrewCapacity) {
    throw new Error("At least one crew slot is required.");
  }

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({ data: {
      guildId: input.guildId,
      channelId: input.channelId,
      reportChannelId: input.reportChannelId,
      createdById: input.createdById,
      createdByName: input.createdByName,
      name: input.name,
      description: input.description,
      logoUrl: input.logoUrl,
      startsAt: input.startsAt,
      lootDurationHours: input.lootDurationHours,
      raffles: {
        create: {
          channelId: input.channelId,
          createdById: input.createdById,
          name: `Loot pool: ${input.name}`,
        },
      },
    } });

    const createdGroups = new Map<string, string>();
    let slotOrder = 0;
    for (const [groupIndex, group] of groups.entries()) {
      const createdGroup = await tx.eventGroup.create({
        data: {
          eventId: event.id,
          kind: group.kind,
          name: group.name,
          scheduleMode: group.scheduleMode,
          startsAt: group.startsAt,
          timingNote: group.timingNote,
          sortOrder: groupIndex,
        },
      });
      createdGroups.set(group.key, createdGroup.id);

      const roles = group.kind === "FLEET"
        ? group.ships.flatMap((ship) => ship.roles.map((role) => ({ ...role, category: ship.name })))
        : group.roles.map((role) => ({ ...role, category: group.name }));
      for (const role of roles) {
        await tx.crewSlot.create({
          data: {
            eventId: event.id,
            groupId: createdGroup.id,
            category: role.category,
            assignmentGroup: group.kind === "FLEET" ? "ship" : "ground",
            label: role.label,
            capacity: role.capacity,
            sortOrder: slotOrder++,
          },
        });
      }
    }

    for (const group of groups) {
      if (!group.predecessorKey) continue;
      await tx.eventGroup.update({
        where: { id: createdGroups.get(group.key)! },
        data: { predecessorGroupId: createdGroups.get(group.predecessorKey) },
      });
    }

    const finalExtraCapacity = input.extraCrewCapacity
      ? Math.min(Math.max(Math.trunc(input.extraCrewCapacity), 1), 25)
      : undefined;
    const extras = finalExtraCapacity
      ? [{ category: "Extra Crew", assignmentGroup: "extra" as const, label: "Extra Crew", capacity: finalExtraCapacity }]
      : extraSlots;
    for (const extra of extras) {
      await tx.crewSlot.create({
        data: { eventId: event.id, ...extra, sortOrder: slotOrder++ },
      });
    }

    return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: eventInclude });
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
