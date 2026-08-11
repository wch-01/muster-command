import assert from "node:assert/strict";
import test from "node:test";
import { lootEligibility } from "./loot-eligibility.js";

const eligibleUser = {
  isLoggedIn: true,
  hasActiveGuildProfile: true,
  isParticipant: true,
  isPoolDrawn: false,
};

void test("participants can add loot to an open event pool", () => {
  assert.equal(lootEligibility(eligibleUser), "ALLOWED");
});

void test("participants can add loot after the event ends while its pool remains open", () => {
  assert.equal(lootEligibility(eligibleUser), "ALLOWED");
});

void test("nonparticipants cannot add loot", () => {
  assert.equal(lootEligibility({ ...eligibleUser, isParticipant: false }), "NOT_PARTICIPANT");
});

void test("a drawn pool cannot receive more loot", () => {
  assert.equal(lootEligibility({ ...eligibleUser, isPoolDrawn: true }), "POOL_DRAWN");
});

void test("a missing active-server profile is reported separately", () => {
  assert.equal(
    lootEligibility({ ...eligibleUser, hasActiveGuildProfile: false }),
    "PROFILE_UNAVAILABLE",
  );
});
