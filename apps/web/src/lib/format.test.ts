import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateTime, formatMoney, formatQty } from "./format";

test("money groups thousands and keeps two decimals", () => {
  assert.equal(formatMoney("1234567.8").replace(/\s/g, " "), "1 234 567,80");
  assert.equal(formatMoney("-350985.54").replace(/\s/g, " "), "-350 985,54");
});

test("quantity drops trailing zeros", () => {
  assert.equal(formatQty("65.000"), "65");
  assert.equal(formatQty("1.500"), "1,5");
});

test("dates are wall time, composed by hand", () => {
  assert.equal(formatDate("2026-09-28T15:52:51.000Z"), "28.09.2026");
  assert.equal(formatDateTime("2026-09-28T15:52:51.000Z"), "28.09.2026 15:52");
});
