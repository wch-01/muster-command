import assert from "node:assert/strict";
import test from "node:test";
import { parseEventStart } from "./event-input.js";

void test("parseEventStart accepts an explicit UTC timestamp", () => {
  assert.equal(parseEventStart("2026-08-11T14:30:00.000Z")?.toISOString(), "2026-08-11T14:30:00.000Z");
});

void test("parseEventStart preserves an explicit numeric offset", () => {
  assert.equal(parseEventStart("2026-08-11T14:30:00+02:00")?.toISOString(), "2026-08-11T12:30:00.000Z");
});

void test("parseEventStart rejects timezone-less browser input", () => {
  assert.throws(() => parseEventStart("2026-08-11T14:30"), /must include a timezone/);
});

void test("parseEventStart allows an omitted start time", () => {
  assert.equal(parseEventStart(""), undefined);
});
