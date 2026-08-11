import assert from "node:assert/strict";
import test from "node:test";
import { activityGroupsFromSlots, normalizeActivityGroups } from "./event-groups.js";

const validGroups = [
  {
    clientId: "fleet-1",
    kind: "FLEET",
    name: "Expedition Fleet",
    scheduleMode: "EVENT_START",
    ships: [{ name: "Carrack", roles: [{ label: "Pilot", capacity: 1 }] }],
  },
  {
    clientId: "ground-1",
    kind: "GROUND",
    name: "Ground Team 1",
    scheduleMode: "AFTER_GROUP",
    predecessorClientId: "fleet-1",
    roles: [{ label: "Combat", capacity: 4 }],
  },
];

void test("normalizes a fleet with ships and a sequential ground team", () => {
  const groups = normalizeActivityGroups(validGroups);
  assert.equal(groups[0].ships[0].name, "Carrack");
  assert.equal(groups[1].predecessorKey, "fleet-1");
});

void test("rejects circular scheduling dependencies", () => {
  assert.throws(
    () => normalizeActivityGroups([
      { ...validGroups[0], scheduleMode: "AFTER_GROUP", predecessorClientId: "ground-1" },
      validGroups[1],
    ]),
    /circular dependency/,
  );
});

void test("requires at least one ship in every fleet", () => {
  assert.throws(() => normalizeActivityGroups([{ ...validGroups[0], ships: [] }]), /at least one ship/);
});

void test("legacy slots become Fleet 1 and named ground teams", () => {
  const groups = activityGroupsFromSlots([
    { category: "Carrack", assignmentGroup: "ship", label: "Pilot", capacity: 1 },
    { category: "Mining Team", assignmentGroup: "ground", label: "Miner", capacity: 3 },
  ], true);
  assert.deepEqual(groups.map((group) => group.name), ["Fleet 1", "Mining Team"]);
  assert.equal(groups[0].scheduleMode, "EVENT_START");
});
