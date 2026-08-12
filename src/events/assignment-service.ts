import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { findScheduleConflict, scheduleConflictMessage } from "./schedule-conflicts.js";

export const assignUserToSlot = async (input: {
  slotId: string;
  expectedEventId?: string;
  expectedGuildId?: string;
  discordUserId: string;
  discordTag: string;
}) => {
  const initialSlot = await prisma.crewSlot.findUnique({
    where: { id: input.slotId },
    select: { eventId: true },
  });
  if (!initialSlot || (input.expectedEventId && initialSlot.eventId !== input.expectedEventId)) {
    throw new Error("That signup slot is no longer open.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${initialSlot.eventId}:${input.discordUserId}`}))`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "CrewSlot" WHERE id = ${input.slotId} FOR UPDATE`);

    const slot = await tx.crewSlot.findUnique({
      where: { id: input.slotId },
      include: { event: true, group: true },
    });
    if (!slot || slot.event.status !== "OPEN") throw new Error("That signup slot is no longer open.");
    if (input.expectedEventId && slot.eventId !== input.expectedEventId) throw new Error("That signup slot is no longer open.");
    if (input.expectedGuildId && slot.event.guildId !== input.expectedGuildId) throw new Error("That event is not in your active server.");

    if (slot.assignmentGroup === "extra") {
      const regularSlots = await tx.crewSlot.findMany({
        where: { eventId: slot.eventId, assignmentGroup: { not: "extra" } },
        include: { assignments: true },
      });
      if (!regularSlots.length || regularSlots.some((regularSlot) => regularSlot.assignments.length < regularSlot.capacity)) {
        throw new Error("Extra crew opens after the listed roles are full.");
      }
    }

    const existingAssignments = await tx.crewAssignment.findMany({
      where: { eventId: slot.eventId, discordUserId: input.discordUserId },
      include: { crewSlot: { include: { group: true } } },
    });
    if (slot.assignmentGroup !== "extra" && existingAssignments.some((assignment) => assignment.assignmentGroup === "extra")) {
      throw new Error("Extra crew members can only stay in the extra crew area.");
    }

    if (slot.group) {
      const assignedGroups = [...new Map(existingAssignments
        .map((assignment) => assignment.crewSlot.group)
        .filter((group) => group && group.id !== slot.groupId)
        .map((group) => [group!.id, group!])).values()];
      const conflict = findScheduleConflict(slot.group, assignedGroups);
      if (conflict) throw new Error(scheduleConflictMessage(conflict));
    }

    if (slot.assignmentGroup === "extra") {
      await tx.crewAssignment.deleteMany({ where: { eventId: slot.eventId, discordUserId: input.discordUserId } });
    } else if (slot.groupId) {
      await tx.crewAssignment.deleteMany({ where: { eventId: slot.eventId, discordUserId: input.discordUserId, groupId: slot.groupId } });
    } else {
      await tx.crewAssignment.deleteMany({ where: { eventId: slot.eventId, discordUserId: input.discordUserId, assignmentGroup: slot.assignmentGroup } });
    }

    const taken = await tx.crewAssignment.count({ where: { crewSlotId: slot.id } });
    if (taken >= slot.capacity) throw new Error("That slot filled up just before you clicked it.");

    await tx.crewAssignment.create({
      data: {
        eventId: slot.eventId,
        crewSlotId: slot.id,
        groupId: slot.groupId,
        assignmentGroup: slot.assignmentGroup,
        discordUserId: input.discordUserId,
        discordTag: input.discordTag,
      },
    });
    return { eventId: slot.eventId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
};
