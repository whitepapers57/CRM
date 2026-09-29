import { test } from "node:test";
import assert from "node:assert/strict";
import { windowStartFor } from "./today";

test("the stored window starts on the 1st of the month two months back", () => {
  assert.equal(windowStartFor("2026-09-29"), "2026-07-01");
  assert.equal(windowStartFor("2026-10-01"), "2026-08-01");
  assert.equal(windowStartFor("2027-02-10"), "2026-12-01");
});
