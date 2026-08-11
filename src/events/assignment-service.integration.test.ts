import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../db.js";
import { assignUserToSlot } from "./assignment-service.js";

const integrationTest = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? test : test.skip;

void integrationTest("enforces group conflicts and serializes final-slot claims", async () => {
  const event = await prisma.event.create({
    data: {
      guildId: "phase-4-integration-guild",
      createdById: "phase-4-test",
      createdByName: "Phase 4 test",
      name: "Phase 4 temporary integration event",
    },
  });

  try {
    const fleet = await prisma.eventGroup.create({
      data: { eventId: event.id, kind: "FLEET", name: "Fleet 1", scheduleMode: "EVENT_START", sortOrder: 0 },
    });
    const secondFleet = await prisma.eventGroup.create({
      data: { eventId: event.id, kind: "FLEET", name: "Fleet 2", scheduleMode: "EVENT_START", sortOrder: 1 },
    });
    const firstTeam = await prisma.eventGroup.create({
      data: {
        eventId: event.id,
        kind: "GROUND",
        name: "Ground Team 1",
        scheduleMode: "AFTER_GROUP",
        predecessorGroupId: fleet.id,
        sortOrder: 2,
      },
    });
    const parallelTeam = await prisma.eventGroup.create({
      data: {
        eventId: event.id,
        kind: "GROUND",
        name: "Ground Team 2",
        scheduleMode: "AFTER_GROUP",
        predecessorGroupId: fleet.id,
        sortOrder: 3,
      },
    });
    const followupTeam = await prisma.eventGroup.create({
      data: {
        eventId: event.id,
        kind: "GROUND",
        name: "Ground Team 3",
        scheduleMode: "AFTER_GROUP",
        predecessorGroupId: firstTeam.id,
        sortOrder: 4,
      },
    });
    const directedTeam = await prisma.eventGroup.create({
      data: { eventId: event.id, kind: "GROUND", name: "Ground Team 4", scheduleMode: "AS_DIRECTED", sortOrder: 5 },
    });
    const contentionTeam = await prisma.eventGroup.create({
      data: { eventId: event.id, kind: "GROUND", name: "Final Slot Team", scheduleMode: "AS_DIRECTED", sortOrder: 6 },
    });

    const makeSlot = (groupId: string, label: string, capacity = 2) => prisma.crewSlot.create({
      data: {
        eventId: event.id,
        groupId,
        category: "Integration Test",
        assignmentGroup: "ground",
        label,
        capacity,
        sortOrder: 0,
      },
    });
    const [fleetSlot, secondFleetSlot, firstTeamSlot, parallelTeamSlot, followupTeamSlot, directedTeamSlot, contentionSlot] =
      await Promise.all([
        makeSlot(fleet.id, "Fleet role"),
        makeSlot(secondFleet.id, "Second fleet role"),
        makeSlot(firstTeam.id, "First team role"),
        makeSlot(parallelTeam.id, "Parallel team role"),
        makeSlot(followupTeam.id, "Follow-up team role"),
        makeSlot(directedTeam.id, "Directed role"),
        makeSlot(contentionTeam.id, "Only opening", 1),
      ]);

    const join = (slotId: string, discordUserId: string) => assignUserToSlot({
      slotId,
      expectedEventId: event.id,
      expectedGuildId: event.guildId,
      discordUserId,
      discordTag: discordUserId,
    });

    await join(fleetSlot.id, "schedule-user");
    await assert.rejects(join(secondFleetSlot.id, "schedule-user"), /Schedule conflict.*Fleet 1/);
    await join(firstTeamSlot.id, "schedule-user");
    await assert.rejects(join(parallelTeamSlot.id, "schedule-user"), /Schedule conflict.*Ground Team 1/);
    await join(followupTeamSlot.id, "schedule-user");
    await join(directedTeamSlot.id, "schedule-user");

    const scheduleAssignments = await prisma.crewAssignment.findMany({
      where: { eventId: event.id, discordUserId: "schedule-user" },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      new Set(scheduleAssignments.map((assignment) => assignment.groupId)),
      new Set([fleet.id, firstTeam.id, followupTeam.id, directedTeam.id]),
    );

    const results = await Promise.allSettled([
      join(contentionSlot.id, "contender-one"),
      join(contentionSlot.id, "contender-two"),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(await prisma.crewAssignment.count({ where: { crewSlotId: contentionSlot.id } }), 1);
  } finally {
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.$disconnect();
  }
});
