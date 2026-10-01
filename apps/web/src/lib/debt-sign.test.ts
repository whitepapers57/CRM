import { test } from "node:test";
import assert from "node:assert/strict";
import { toDebtSign } from "./debt-sign";

test("a supplier statement switches to the 1C sign: what we owe is negative", () => {
  const s = toDebtSign({
    opening: "1000.00",
    received: "500.00",
    paid: "0.00",
    closing: "1500.00",
    rows: [{ kind: "purchase", sdId: "b", date: "2026-09-10T09:00:00.000Z", amount: "500.00", balance: "1500.00" }],
  });
  assert.equal(s.opening, "-1000.00");
  assert.equal(s.closing, "-1500.00");
  assert.deepEqual([s.rows[0].amount, s.rows[0].balance], ["-500.00", "-1500.00"]);
  assert.equal(s.received, "500.00");
});

test("zero stays zero and a negative turns positive", () => {
  const s = toDebtSign({ opening: "0.00", received: "0.00", paid: "0.00", closing: "-5.00", rows: [] });
  assert.equal(s.opening, "0.00");
  assert.equal(s.closing, "5.00");
});
