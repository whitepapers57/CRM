import { test } from "node:test";
import assert from "node:assert/strict";
import { windowStartFor } from "./today";

test("the stored window starts on the 1st of the current month", () => {
  assert.equal(windowStartFor("2026-09-29"), "2026-09-01");
  assert.equal(windowStartFor("2026-10-01"), "2026-10-01");
  assert.equal(windowStartFor("2027-01-10"), "2027-01-01");
});
