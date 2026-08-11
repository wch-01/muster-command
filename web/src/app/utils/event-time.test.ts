import assert from "node:assert/strict";
import test from "node:test";
import { browserTimeZoneLabel, localDateTimeToIso } from "./event-time";

void test("localDateTimeToIso sends an explicit UTC timestamp", () => {
  const localInput = "2026-08-11T14:30";
  const result = localDateTimeToIso(localInput);

  assert.equal(result, new Date(localInput).toISOString());
  assert.match(result ?? "", /Z$/);
});

void test("localDateTimeToIso allows an omitted start time", () => {
  assert.equal(localDateTimeToIso(""), undefined);
});

void test("browserTimeZoneLabel identifies the browser timezone", () => {
  assert.match(browserTimeZoneLabel(), /\S+/);
});
