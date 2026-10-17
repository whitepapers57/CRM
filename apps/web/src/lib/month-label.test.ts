import { test } from "node:test";
import assert from "node:assert/strict";
import { monthName } from "./month-label";

test("calendar month names come from the catalogue, never Intl's «M09» for Uzbek", () => {
  assert.equal(monthName("uz", new Date(2026, 8, 1)), "Sentabr");
  assert.equal(monthName("uz", new Date(2026, 0, 31)), "Yanvar");
  assert.equal(monthName("ru", new Date(2026, 11, 1)), "Декабрь");
  for (let m = 0; m < 12; m++) {
    assert.doesNotMatch(monthName("uz", new Date(2026, m, 1)), /^M\d/);
    assert.doesNotMatch(monthName("ru", new Date(2026, m, 1)), /^M\d/);
  }
});
