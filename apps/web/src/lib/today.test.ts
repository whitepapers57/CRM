import { test } from "node:test";
import assert from "node:assert/strict";
import { windowStartFor } from "./today";

test("stored data always starts on 1 Sep 2026", () => {
  assert.equal(windowStartFor(), "2026-09-01");
  assert.equal(windowStartFor(), "2026-09-01");
});
