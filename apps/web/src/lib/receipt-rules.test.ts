import { test } from "node:test";
import assert from "node:assert/strict";
import { dateProblem, decimals } from "./receipt-rules";

test("a receipt date: before the data start, in a closed month, in the future, or fine", () => {
  const closed = new Set(["2026-09"]);
  assert.equal(dateProblem("2026-08-31", closed, "2026-10-03"), "before");
  assert.equal(dateProblem("2026-09-15", closed, "2026-10-03"), "closed");
  assert.equal(dateProblem("2026-10-04", closed, "2026-10-03"), "future");
  assert.equal(dateProblem("2026-10-03", closed, "2026-10-03"), null);
  assert.equal(dateProblem("2026-09-15", new Set(), "2026-10-03"), null);
});

test("counts decimals the way the user typed them", () => {
  assert.equal(decimals("12"), 0);
  assert.equal(decimals("12.5"), 1);
  assert.equal(decimals("12,345"), 3);
  assert.equal(decimals("9101.83"), 2);
  assert.equal(decimals("1.2000"), 1);
});
