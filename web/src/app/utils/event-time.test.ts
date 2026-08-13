import assert from "node:assert/strict";
import test from "node:test";
import { browserTimeZoneLabel, formatDateTime24, localDateTimeToIso } from "./event-time";

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

void test("formatDateTime24 always uses a 24-hour clock", () => {
  const morning = formatDateTime24(new Date(2026, 7, 11, 5, 7));
  const evening = formatDateTime24(new Date(2026, 7, 11, 17, 7));

  assert.match(morning, /0507/);
  assert.match(evening, /1707/);
  assert.doesNotMatch(`${morning} ${evening}`, /\d{2}:\d{2}/);
  assert.doesNotMatch(`${morning} ${evening}`, /\b(?:AM|PM)\b/i);
});
