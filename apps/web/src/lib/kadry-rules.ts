import type { MessageKey } from "../i18n/messages";
import type { KadryEmployee, WorkSchedule } from "./api";

// Same values as apps/api/src/kadry/employee-rules.ts.
export const GENDERS = ["male", "female"] as const;
export const EMPLOYMENT_TYPES = ["TD", "GPH", "IP", "SZ"] as const;
export const EDUCATION_LEVELS = ["higher", "incomplete_higher", "specialized_secondary", "secondary", "incomplete_secondary"] as const;
export const RELATIONS = ["spouse", "mother", "father", "child", "sibling", "other"] as const;
export const DEGREES = ["Бакалавр", "Магистр", "Доктор", "Среднее", "Среднее спец."] as const;
export const DIPLOMA_STATUSES = ["Подтверждён", "Не подтверждён"] as const;

/** Stored (Russian) diploma values -> message keys, so the UI can show them in the viewer's language. */
export const DEGREE_KEYS: Record<string, MessageKey> = {
  "Бакалавр": "kadry.degree.bachelor", "Магистр": "kadry.degree.master", "Доктор": "kadry.degree.doctor",
  "Среднее": "kadry.degree.secondary", "Среднее спец.": "kadry.degree.secondary_special",
};
export const DIPLOMA_STATUS_KEYS: Record<string, MessageKey> = { "Подтверждён": "kadry.dstatus.confirmed", "Не подтверждён": "kadry.dstatus.unconfirmed" };
/** Label for a stored degree / status value; an unknown value is shown as stored. */
export const labelFor = (map: Record<string, MessageKey>, value: string, t: (k: MessageKey) => string) => (map[value] ? t(map[value]) : value);

/** Every editable employee field as typed in the form: strings (dates YYYY-MM-DD or ""), a checkbox and a schedule. */
export interface EmployeeForm {
  lastName: string; firstName: string; middleName: string;
  phone: string; email: string;
  birthDate: string; birthPlace: string; nationality: string; citizenship: string;
  gender: string;
  passportSeries: string; passportNumber: string; passportIssuedBy: string; passportIssuedDate: string; passportValidUntil: string;
  pinfl: string; inn: string; address: string; educationLevel: string;
  departmentId: string; positionId: string; employmentType: string; remote: boolean;
  workSchedule: WorkSchedule | null;
  rate: string; salary: string;
  hiredAt: string; orderNumber: string; orderDate: string; experienceMonths: string;
  status: "intern" | "active";
}

export type EmployeeProblems = Partial<Record<keyof EmployeeForm | "workSchedule", MessageKey>>;

/** A blank form; hire and order dates default to today, rate to 1. */
export function emptyEmployeeForm(today: string): EmployeeForm {
  return {
    lastName: "", firstName: "", middleName: "", phone: "", email: "",
    birthDate: "", birthPlace: "", nationality: "", citizenship: "", gender: "",
    passportSeries: "", passportNumber: "", passportIssuedBy: "", passportIssuedDate: "", passportValidUntil: "",
    pinfl: "", inn: "", address: "", educationLevel: "",
    departmentId: "", positionId: "", employmentType: "", remote: false, workSchedule: null,
    rate: "1", salary: "", hiredAt: today, orderNumber: "", orderDate: today, experienceMonths: "",
    status: "active",
  };
}

/** The edit form's start state: the whole card, because the API's PUT replaces every editable field. */
export function employeeFormFrom(e: KadryEmployee): EmployeeForm {
  const s = (v: string | number | null) => (v == null ? "" : String(v));
  return {
    lastName: e.lastName, firstName: e.firstName, middleName: s(e.middleName), phone: s(e.phone), email: s(e.email),
    birthDate: s(e.birthDate), birthPlace: s(e.birthPlace), nationality: s(e.nationality), citizenship: s(e.citizenship), gender: s(e.gender),
    passportSeries: s(e.passportSeries), passportNumber: s(e.passportNumber), passportIssuedBy: s(e.passportIssuedBy),
    passportIssuedDate: s(e.passportIssuedDate), passportValidUntil: s(e.passportValidUntil),
    pinfl: s(e.pinfl), inn: s(e.inn), address: s(e.address), educationLevel: s(e.educationLevel),
    departmentId: s(e.departmentId), positionId: s(e.positionId), employmentType: s(e.employmentType), remote: e.remote, workSchedule: e.workSchedule,
    rate: s(e.rate), salary: s(e.salary), hiredAt: s(e.hiredAt), orderNumber: s(e.orderNumber), orderDate: s(e.orderDate), experienceMonths: s(e.experienceMonths),
    status: e.status === "intern" ? "intern" : "active",
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string | undefined) => (v ?? "").trim();
const compact = (v: string | undefined) => clean(v).replace(/\s+/g, "");
// 12 Oct 2026: toISOString() throws a RangeError on «2026-13-01»; Date.parse is NaN there, so check it first.
// const validDay = (s: string) => DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const validDay = (s: string) => {
  if (!DAY.test(s)) return false;
  const ms = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === s;
};

/** Why a custom schedule cannot be saved (the API refuses the same cases), or null. null / absent schedule = "by position". */
export function scheduleProblem(s: WorkSchedule | null | undefined): MessageKey | null {
  if (s == null) return null;
  const days = Object.values(s);
  if (days.length === 0) return "kadry.err.no_days";
  if (days.some((d) => !TIME.test(clean(d.start)) || !TIME.test(clean(d.end)))) return "kadry.err.time";
  if (days.some((d) => clean(d.end) <= clean(d.start))) return "kadry.err.end_before_start";
  return null;
}

/** Field errors for the employee form, mirroring apps/api/src/kadry/employee-rules.ts `cleanEmployee`. `today` is the Tashkent day. */
export function employeeProblems(form: Partial<EmployeeForm>, today: string): EmployeeProblems {
  const p: EmployeeProblems = {};
  if (!clean(form.lastName)) p.lastName = "kadry.err.last_name";
  if (!clean(form.firstName)) p.firstName = "kadry.err.first_name";
  const birth = clean(form.birthDate);
  if (birth) {
    if (!validDay(birth)) p.birthDate = "kadry.err.date";
    else if (birth > today) p.birthDate = "kadry.err.birth_future";
  }
  for (const k of ["passportIssuedDate", "passportValidUntil", "hiredAt", "orderDate"] as const) {
    const v = clean(form[k]);
    if (v && !validDay(v)) p[k] = "kadry.err.date";
  }
  const series = clean(form.passportSeries).toUpperCase();
  if (series && !/^[A-ZА-ЯЁ]{2}$/.test(series)) p.passportSeries = "kadry.err.passport_series";
  const number = compact(form.passportNumber);
  if (number && !/^\d{7}$/.test(number)) p.passportNumber = "kadry.err.passport_number";
  const pinfl = compact(form.pinfl);
  if (pinfl && !/^\d{14}$/.test(pinfl)) p.pinfl = "kadry.err.pinfl";
  const inn = compact(form.inn);
  if (inn && !/^\d+$/.test(inn)) p.inn = "kadry.err.inn";
  const email = clean(form.email);
  if (email && !email.includes("@")) p.email = "kadry.err.email";
  const rate = clean(form.rate).replace(",", ".");
  if (rate && (!/^\d+(\.\d{1,2})?$/.test(rate) || !(Number(rate) > 0) || Number(rate) > 99.99)) p.rate = "kadry.err.rate";
  const whole = (v: string | undefined, max: number) => {
    const s = compact(v);
    return !s || (/^-?\d+$/.test(s) && Number(s) >= 0 && Number(s) <= max);
  };
  if (!whole(form.salary, 2_000_000_000)) p.salary = "kadry.err.salary";
  if (!whole(form.experienceMonths, 1200)) p.experienceMonths = "kadry.err.experience";
  const sched = scheduleProblem(form.workSchedule);
  if (sched) p.workSchedule = sched;
  return p;
}

export const fullName = (last: string, first: string, middle?: string | null) => [last, first, middle].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");

/** Whole years between a YYYY-MM-DD birth date and today. */
export function ageYears(birth: string, today: string): number {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

// 12 Oct 2026: units were hard-coded Russian («г», «мес») and showed on Uzbek pages; they come from translations now.
// /** «3 г 2 мес», «5 мес», «2 г». */
// export function tenureLabel(months: number): string {
//   const m = Math.max(0, Math.round(months));
//   const years = Math.floor(m / 12);
//   const rest = m % 12;
//   if (years === 0) return `${rest} мес`;
//   return rest === 0 ? `${years} г` : `${years} г ${rest} мес`;
// }
/** «3 г 2 мес», «5 мес», «2 г»; `units` are the translated short words. */
export function tenureLabel(months: number, units: { years: string; months: string }): string {
  const m = Math.max(0, Math.round(months));
  const years = Math.floor(m / 12);
  const rest = m % 12;
  if (years === 0) return `${rest} ${units.months}`;
  return rest === 0 ? `${years} ${units.years}` : `${years} ${units.years} ${rest} ${units.months}`;
}

/**
 * Options for a position Select. A name shared by two positions is labelled «Должность (Отдел)», and the
 * `selectedId` position is always present even when `shown` (the department-filtered list) no longer contains it.
 */
export function positionOptions(
  all: Array<{ id: string; name: string; departmentName: string | null }>,
  shown: Array<{ id: string; name: string; departmentName: string | null }>,
  selectedId: string,
): Array<{ value: string; label: string }> {
  const counts = new Map<string, number>();
  for (const p of all) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  const list = shown.some((p) => p.id === selectedId) ? shown : [...shown, ...all.filter((p) => p.id === selectedId)];
  return list.map((p) => ({ value: p.id, label: (counts.get(p.name) ?? 0) > 1 && p.departmentName ? `${p.name} (${p.departmentName})` : p.name }));
}
