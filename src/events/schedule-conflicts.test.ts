import assert from "node:assert/strict";
import test from "node:test";
import { groupsConflict } from "./schedule-conflicts.js";

const group = (overrides: Partial<Parameters<typeof groupsConflict>[0]> = {}) => ({
  id: "group-a", name: "Group A", scheduleMode: "EVENT_START", startsAt: null, predecessorGroupId: null, ...overrides,
});

void test("groups starting at event start conflict", () => {
  assert.equal(groupsConflict(group(), group({ id: "group-b", name: "Group B" })), true);
});

void test("specific-time groups conflict only at the same instant", () => {
  const first = group({ scheduleMode: "SPECIFIC_TIME", startsAt: "2026-08-11T14:00:00Z" });
  assert.equal(groupsConflict(first, group({ id: "b", scheduleMode: "SPECIFIC_TIME", startsAt: "2026-08-11T14:00:00Z" })), true);
  assert.equal(groupsConflict(first, group({ id: "c", scheduleMode: "SPECIFIC_TIME", startsAt: "2026-08-11T15:00:00Z" })), false);
});

void test("groups waiting on the same predecessor conflict", () => {
  const first = group({ scheduleMode: "AFTER_GROUP", predecessorGroupId: "fleet-1" });
  assert.equal(groupsConflict(first, group({ id: "b", scheduleMode: "AFTER_GROUP", predecessorGroupId: "fleet-1" })), true);
  assert.equal(groupsConflict(first, group({ id: "c", scheduleMode: "AFTER_GROUP", predecessorGroupId: "ground-1" })), false);
});

void test("dependency chains and as-directed schedules are not definite conflicts", () => {
  const first = group();
  const afterFirst = group({ id: "b", scheduleMode: "AFTER_GROUP", predecessorGroupId: first.id });
  assert.equal(groupsConflict(first, afterFirst), false);
  assert.equal(groupsConflict(first, group({ id: "c", scheduleMode: "AS_DIRECTED" })), false);
});
