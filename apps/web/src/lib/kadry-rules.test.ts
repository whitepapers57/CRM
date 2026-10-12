import { test } from "node:test";
import assert from "node:assert/strict";
import { ageYears, employeeProblems, positionOptions, scheduleProblem, tenureLabel } from "./kadry-rules";

const today = "2026-10-12";
const base = { lastName: "Нишонов", firstName: "Шоядбек" };

test("needs last and first name, and checks documents like the API", () => {
  assert.deepEqual(employeeProblems({ lastName: "", firstName: " " }, today), { lastName: "kadry.err.last_name", firstName: "kadry.err.first_name" });
  assert.deepEqual(employeeProblems({ ...base, passportSeries: "A1", passportNumber: "12345", pinfl: "123", inn: "1a" }, today), {
    passportSeries: "kadry.err.passport_series", passportNumber: "kadry.err.passport_number", pinfl: "kadry.err.pinfl", inn: "kadry.err.inn",
  });
  assert.deepEqual(employeeProblems({ ...base, pinfl: "3010 1990 1234 56", passportSeries: "ad", passportNumber: "123 45 67" }, today), {});
  assert.deepEqual(employeeProblems({ ...base, birthDate: "2026-10-13", salary: "-1", rate: "0", experienceMonths: "1.5" }, today), {
    birthDate: "kadry.err.birth_future", salary: "kadry.err.salary", rate: "kadry.err.rate", experienceMonths: "kadry.err.experience",
  });
  assert.deepEqual(employeeProblems({ ...base, salary: "6 000 000", rate: "0,5" }, today), {});
});

test("checks the schedule", () => {
  assert.equal(scheduleProblem(null), null);
  assert.equal(scheduleProblem({}), "kadry.err.no_days");
  assert.equal(scheduleProblem({ "1": { start: "", end: "18:00" } }), "kadry.err.time");
  assert.equal(scheduleProblem({ "1": { start: "18:00", end: "09:00" } }), "kadry.err.end_before_start");
  assert.equal(scheduleProblem({ "1": { start: "09:00", end: "18:00" } }), null);
});

test("ages and tenure", () => {
  assert.equal(ageYears("1990-10-13", today), 35);
  assert.equal(ageYears("1990-10-12", today), 36);
  const ru = { years: "г", months: "мес" };
  const uz = { years: "y.", months: "oy" };
  assert.equal(tenureLabel(38, ru), "3 г 2 мес");
  assert.equal(tenureLabel(5, ru), "5 мес");
  assert.equal(tenureLabel(24, ru), "2 г");
  assert.equal(tenureLabel(38, uz), "3 y. 2 oy");
});

test("impossible calendar days are problems, not crashes", () => {
  assert.deepEqual(employeeProblems({ ...base, birthDate: "2026-13-01" }, today), { birthDate: "kadry.err.date" });
  assert.deepEqual(employeeProblems({ ...base, hiredAt: "2026-02-32" }, today), { hiredAt: "kadry.err.date" });
  assert.deepEqual(employeeProblems({ ...base, hiredAt: "2026-02-30" }, today), { hiredAt: "kadry.err.date" });
  assert.deepEqual(employeeProblems({ ...base, hiredAt: "2024-02-29" }, today), {});
});

test("position options: selected one stays, repeated names get their department", () => {
  const all = [
    { id: "a", name: "Менеджер", departmentName: "Продажи" },
    { id: "b", name: "Менеджер", departmentName: "Склад" },
    { id: "c", name: "Водитель", departmentName: "Склад" },
  ];
  assert.deepEqual(positionOptions(all, all.slice(0, 1), "a"), [{ value: "a", label: "Менеджер (Продажи)" }]);
  assert.deepEqual(positionOptions(all, all.slice(0, 1), "c"), [{ value: "a", label: "Менеджер (Продажи)" }, { value: "c", label: "Водитель" }]);
  assert.deepEqual(positionOptions(all, [], ""), []);
});
