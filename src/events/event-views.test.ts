import assert from "node:assert/strict";
import test from "node:test";
import { eventEmbed } from "./event-views.js";

const baseEvent = {
  id: "event-1",
  guildId: "guild-1",
  channelId: null,
  reportChannelId: null,
  messageId: null,
  createdById: "owner-1",
  createdByName: "Owner",
  name: "Operation Test",
  description: null,
  logoUrl: null,
  startsAt: new Date("2026-08-11T14:00:00.000Z"),
  endedAt: null,
  status: "OPEN",
  lootDurationHours: 24,
  createdAt: new Date("2026-08-11T12:00:00.000Z"),
  updatedAt: new Date("2026-08-11T12:00:00.000Z"),
};

void test("Discord event embed preserves fleet, ship, ground team, and sequence", () => {
  const fleet = {
    id: "fleet-1", eventId: "event-1", kind: "FLEET", name: "Expedition Fleet",
    scheduleMode: "EVENT_START", startsAt: null, timingNote: null, predecessorGroupId: null, sortOrder: 0,
  };
  const ground = {
    id: "ground-1", eventId: "event-1", kind: "GROUND", name: "Mining Team",
    scheduleMode: "AFTER_GROUP", startsAt: null, timingNote: "Deploy when clear", predecessorGroupId: fleet.id, sortOrder: 1,
  };
  const slotBase = {
    eventId: "event-1", capacity: 1, sortOrder: 0, createdAt: new Date("2026-08-11T12:00:00.000Z"),
  };
  const event = {
    ...baseEvent,
    groups: [fleet, ground],
    slots: [
      { ...slotBase, id: "pilot", groupId: fleet.id, category: "Carrack", assignmentGroup: "ship", label: "Pilot", assignments: [] },
      { ...slotBase, id: "miner", groupId: ground.id, category: "Mining Team", assignmentGroup: "ground", label: "Miner", assignments: [] },
    ],
  };

  const fields = eventEmbed(event as never).toJSON().fields ?? [];
  assert.equal(fields[0]?.name, "Expedition Fleet › Carrack");
  assert.match(fields[0]?.value ?? "", /At event start/);
  assert.equal(fields[1]?.name, "Mining Team");
  assert.match(fields[1]?.value ?? "", /After Expedition Fleet/);
  assert.match(fields[1]?.value ?? "", /Deploy when clear/);
});
