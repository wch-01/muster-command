import assert from "node:assert/strict";
import test from "node:test";
import { commandAccessForGuild, memberCommandTier, tierAllowsCapability, updateCommandAccessForGuild } from "./command-access.js";

void test("highest mapped role wins and tiers inherit lower defaults", () => {
  const settings = { tier1RoleIds: "one", tier2RoleIds: "two", tier3RoleIds: "three" };
  assert.equal(memberCommandTier(["three", "two"], settings), 2);
  assert.equal(tierAllowsCapability(2, "event.end", settings), true);
  assert.equal(tierAllowsCapability(2, "event.list", settings), true);
  assert.equal(tierAllowsCapability(2, "event.create", settings), false);
  assert.equal(tierAllowsCapability(1, "loot.draw", settings), true);
});

void test("custom lower-tier commands are inherited upward", () => {
  const settings = { tier3Capabilities: "event.list,loot.add", tier2Capabilities: "event.end" };
  assert.equal(tierAllowsCapability(3, "loot.add", settings), true);
  assert.equal(tierAllowsCapability(2, "loot.add", settings), true);
  assert.equal(tierAllowsCapability(undefined, "event.list", settings), false);
});

void test("command access is stored independently for each server", () => {
  let serialized = updateCommandAccessForGuild(undefined, "guild-a", { tier1RoleIds: "a-admin" });
  serialized = updateCommandAccessForGuild(serialized, "guild-b", { tier1RoleIds: "b-admin" });
  assert.equal(commandAccessForGuild(serialized, "guild-a").tier1RoleIds, "a-admin");
  assert.equal(commandAccessForGuild(serialized, "guild-b").tier1RoleIds, "b-admin");
});
