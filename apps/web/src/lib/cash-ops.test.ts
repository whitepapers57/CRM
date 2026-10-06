import { test } from "node:test";
import assert from "node:assert/strict";
import { NEEDS, OPS_FOR_PAGE, changedCashFields, cleanAmount, needsOf, parseAmountInput } from "./cash-ops";

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

test("amounts typed or pasted with spaces parse", () => {
  assert.equal(parseAmountInput("1 500 000"), 1500000);
  assert.equal(parseAmountInput("1 500 000,50"), 1500000.5);
  assert.equal(parseAmountInput("1 500"), 1500);
  assert.equal(parseAmountInput("12,345"), 12.345);
  assert.equal(cleanAmount("12,345"), "12.345");
  assert.equal(parseAmountInput(""), null);
  assert.equal(parseAmountInput("  "), null);
  assert.equal(parseAmountInput("abc"), null);
  assert.equal(parseAmountInput("1.2.3"), null);
});

test("each page's create menu mirrors the API", () => {
  assert.equal(OPS_FOR_PAGE["cash-out"].length, 12);
  assert.equal(OPS_FOR_PAGE["bank-out"].length, 11);
  assert.equal(OPS_FOR_PAGE["cash-out"][8], "cash_to_bank");
  assert.ok(!OPS_FOR_PAGE["bank-out"].includes("cash_to_bank"));
  assert.deepEqual(OPS_FOR_PAGE["bank-in"], ["from_buyer", "supplier_refund", "employee_loan_return", "credit_received", "other_income"]);
  assert.deepEqual(OPS_FOR_PAGE["cash-in"], OPS_FOR_PAGE["bank-in"]);
  for (const ops of Object.values(OPS_FOR_PAGE)) for (const o of ops) assert.ok(o in NEEDS);
});

test("history lists only the cash fields that changed", () => {
  const a = { date: "2026-10-02", amount: "100.00", account: "bank", bankAccountId: "b1", supplierSdId: "1", comment: null, categoryId: null };
  assert.deepEqual(changedCashFields(a, { ...a, amount: "120.00", comment: "x" }), ["amount", "comment"]);
  assert.deepEqual(changedCashFields(a, { ...a, bankAccountId: "b2", supplierSdId: "2", categoryId: "" }), ["bankAccountId", "supplierSdId"]);
  assert.deepEqual(changedCashFields(a, { ...a }), []);
});
