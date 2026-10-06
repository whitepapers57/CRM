import { test } from "node:test";
import assert from "node:assert/strict";
import { NEEDS, needsOf } from "./cash-ops";

test("every operation names the one field its form needs", () => {
  assert.equal(Object.keys(NEEDS).length, 17);
  assert.equal(needsOf("supplier_payment"), "supplier");
  assert.equal(needsOf("buyer_refund"), "outlet");
  assert.equal(needsOf("taxes"), "expenseCategory");
  assert.equal(needsOf("other_income"), "incomeCategory");
  assert.equal(needsOf("salary"), "name");
  assert.equal(needsOf("payroll"), "none");
  assert.equal(needsOf("cash_to_bank"), "none");
  assert.equal(needsOf("nope"), "none");
});
