import { test } from "node:test";
import assert from "node:assert/strict";
import { dateToDay, dayToDate } from "./day";

test("a day string becomes that calendar day, whatever the time zone", () => {
  const d = dayToDate("2026-09-01");
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 9, 1]);
});

test("a calendar date becomes its day string without shifting", () => {
  assert.equal(dateToDay(new Date(2026, 8, 30, 23, 59)), "2026-09-30");
  assert.equal(dateToDay(new Date(2026, 0, 1, 0, 0)), "2026-01-01");
});

test("round trip keeps the day", () => {
  for (const s of ["2026-07-01", "2026-12-31", "2027-02-28"]) assert.equal(dateToDay(dayToDate(s)), s);
});
