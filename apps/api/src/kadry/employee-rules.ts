import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

export const GENDERS = ['male', 'female'] as const;
export const EMPLOYMENT_TYPES = ['TD', 'GPH', 'IP', 'SZ'] as const;
export const EDUCATION_LEVELS = ['higher', 'incomplete_higher', 'specialized_secondary', 'secondary', 'incomplete_secondary'] as const;
export const RELATIONS = ['spouse', 'mother', 'father', 'child', 'sibling', 'other'] as const;
export const DEGREES = ['Бакалавр', 'Магистр', 'Доктор', 'Среднее', 'Среднее спец.'] as const;
export const DIPLOMA_STATUSES = ['Подтверждён', 'Не подтверждён'] as const;

export type WorkSchedule = Record<string, { start: string; end: string }>;
export interface EmployeeInput {
  lastName?: string; firstName?: string; middleName?: string | null;
  phone?: string | null; email?: string | null;
  birthDate?: string | null; birthPlace?: string | null; nationality?: string | null; citizenship?: string | null;
  gender?: string | null;
  passportSeries?: string | null; passportNumber?: string | null; passportIssuedBy?: string | null;
  passportIssuedDate?: string | null; passportValidUntil?: string | null;
  pinfl?: string | null; inn?: string | null; address?: string | null; educationLevel?: string | null;
  departmentId?: string | null; positionId?: string | null; employmentType?: string | null; remote?: boolean;
  workSchedule?: WorkSchedule | null; rate?: number | string | null; salary?: number | string | null;
  hiredAt?: string | null; orderNumber?: string | null; orderDate?: string | null; experienceMonths?: number | string | null;
  /** Only on create: "intern" | "active" (default "active"). */
  status?: string;
}

const bad = (m: string) => new BadRequestException(m);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const digits = (v: unknown) => { const t = text(typeof v === 'number' ? String(v) : v); return t ? t.replace(/\s+/g, '') : null; };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function dayOf(v: unknown): Date | null {
  const s = text(v);
  if (!s) return null;
  if (!DAY.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw bad('Неверная дата');
  return new Date(`${s}T00:00:00Z`);
}
function oneOf<T extends string>(v: unknown, list: readonly T[], message: string): T | null {
  const s = text(v);
  if (!s) return null;
  if (!(list as readonly string[]).includes(s)) throw bad(message);
  return s as T;
}
function wholeNumber(v: unknown, message: string, max: number): number | null {
  const s = digits(v);
  if (s == null) return null;
  if (!/^-?\d+$/.test(s)) throw bad(message);
  const n = Number(s);
  if (n < 0 || n > max) throw bad(message);
  return n;
}

export const fullName = (last: string, first: string, middle: string | null) => [last, first, middle].filter(Boolean).join(' ');

export function cleanSchedule(v: unknown): WorkSchedule | null {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw bad('Неверный график работы');
  const out: WorkSchedule = {};
  for (const [k, d] of Object.entries(v as Record<string, { start?: unknown; end?: unknown }>)) {
    if (!/^[1-7]$/.test(k)) throw bad('Неверный график работы');
    const start = text(d?.start);
    const end = text(d?.end);
    if (!start || !end || !TIME.test(start) || !TIME.test(end)) throw bad('Укажите время');
    if (end <= start) throw bad('Конец должен быть позже начала');
    out[k] = { start, end };
  }
  if (Object.keys(out).length === 0) throw bad('Отметьте рабочие дни');
  return out;
}

/** Validates and normalises an employee; `today` = Tashkent day "YYYY-MM-DD". Does not check that department/position exist. */
export function cleanEmployee(i: EmployeeInput, today: string) {
  const lastName = text(i?.lastName);
  if (!lastName) throw bad('Введите фамилию');
  const firstName = text(i?.firstName);
  if (!firstName) throw bad('Введите имя');
  const middleName = text(i?.middleName);
  const birthDate = dayOf(i.birthDate);
  if (birthDate && birthDate.toISOString().slice(0, 10) > today) throw bad('Дата рождения в будущем');
  const passportIssuedDate = dayOf(i.passportIssuedDate);
  const passportValidUntil = dayOf(i.passportValidUntil);
  const hiredAt = dayOf(i.hiredAt);
  const orderDate = dayOf(i.orderDate);
  const gender = oneOf(i.gender, GENDERS, 'Неверный пол');
  const series = text(i.passportSeries)?.toUpperCase() ?? null;
  if (series && !/^[A-ZА-ЯЁ]{2}$/.test(series)) throw bad('Серия паспорта — 2 буквы');
  const passportNumber = digits(i.passportNumber);
  if (passportNumber && !/^\d{7}$/.test(passportNumber)) throw bad('Номер паспорта — 7 цифр');
  const pinfl = digits(i.pinfl);
  if (pinfl && !/^\d{14}$/.test(pinfl)) throw bad('ПИНФЛ — 14 цифр');
  const inn = digits(i.inn);
  if (inn && !/^\d+$/.test(inn)) throw bad('ИНН — только цифры');
  const email = text(i.email);
  if (email && !email.includes('@')) throw bad('Неверный email');
  const educationLevel = oneOf(i.educationLevel, EDUCATION_LEVELS, 'Неверный уровень образования');
  const employmentType = oneOf(i.employmentType, EMPLOYMENT_TYPES, 'Неверный тип занятости');
  const workSchedule = cleanSchedule(i.workSchedule);
  if (i.rate != null && typeof i.rate !== 'number' && typeof i.rate !== 'string') throw bad('Ставка — число больше 0');
  const rateText = i.rate == null || String(i.rate).trim() === '' ? '1' : String(i.rate).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(rateText) || !(Number(rateText) > 0) || Number(rateText) > 99.99) throw bad('Ставка — число больше 0');
  const salary = wholeNumber(i.salary, 'Оклад — целое число сум', 2_000_000_000);
  const experienceMonths = wholeNumber(i.experienceMonths, 'Стаж — целое число месяцев', 1200);
  const status = i.status == null || i.status === '' ? 'active' : i.status;
  if (status !== 'intern' && status !== 'active') throw bad('Неверный статус');
  return {
    lastName, firstName, middleName, name: fullName(lastName, firstName, middleName),
    phone: text(i.phone), email, birthDate, birthPlace: text(i.birthPlace), nationality: text(i.nationality), citizenship: text(i.citizenship),
    gender, passportSeries: series, passportNumber, passportIssuedBy: text(i.passportIssuedBy), passportIssuedDate, passportValidUntil,
    pinfl, inn, address: text(i.address), educationLevel,
    departmentId: text(i.departmentId), positionId: text(i.positionId), employmentType, remote: i.remote === true,
    workSchedule, rate: new Prisma.Decimal(rateText).toFixed(2), salary, hiredAt, orderNumber: text(i.orderNumber), orderDate, experienceMonths,
    status,
  };
}

export function cleanRelative(i: Record<string, unknown>) {
  const relation = oneOf(i?.relation, RELATIONS, 'Выберите степень родства');
  if (!relation) throw bad('Выберите степень родства');
  return {
    relation, fullName: text(i.fullName), birthDate: dayOf(i.birthDate), workplacePosition: text(i.workplacePosition),
    residenceAddress: text(i.residenceAddress), phone: text(i.phone),
  };
}

export function cleanDiploma(i: Record<string, unknown>) {
  const year = (v: unknown) => {
    const n = wholeNumber(v, 'Неверный год', 2100);
    if (n != null && n < 1900) throw bad('Неверный год');
    return n;
  };
  return {
    degree: oneOf(i?.degree, DEGREES, 'Неверная степень'), institution: text(i?.institution), specialty: text(i?.specialty),
    enrolledYear: year(i?.enrolledYear), graduatedYear: year(i?.graduatedYear), seriesNumber: text(i?.seriesNumber),
    issuedDate: dayOf(i?.issuedDate), status: oneOf(i?.status, DIPLOMA_STATUSES, 'Неверный статус диплома'),
  };
}
