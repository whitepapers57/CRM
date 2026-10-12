import { cleanDiploma, cleanEmployee, cleanRelative, cleanSchedule, fullName } from './employee-rules.js';

const today = '2026-10-12';
const ok = { lastName: ' Нишонов ', firstName: 'Шоядбек', middleName: '' };

describe('employee rules', () => {
  it('builds the full name and stores empty strings as null', () => {
    const e = cleanEmployee({ ...ok, phone: '  ', address: ' Андижан ' }, today);
    expect(e).toMatchObject({ lastName: 'Нишонов', firstName: 'Шоядбек', middleName: null, name: 'Нишонов Шоядбек', phone: null, address: 'Андижан', status: 'active', remote: false });
    expect(fullName('Нишонов', 'Шоядбек', 'Абдуллаевич')).toBe('Нишонов Шоядбек Абдуллаевич');
  });

  it('normalises identity documents', () => {
    const e = cleanEmployee({ ...ok, passportSeries: 'ad', passportNumber: '123 45 67', pinfl: '3010 1990 1234 56', inn: ' 123456789 ' }, today);
    expect(e).toMatchObject({ passportSeries: 'AD', passportNumber: '1234567', pinfl: '30101990123456', inn: '123456789' });
    expect(cleanEmployee({ ...ok, passportSeries: 'аб' }, today).passportSeries).toBe('АБ');
  });

  it.each([
    [{ lastName: '' }, 'Введите фамилию'],
    [{ firstName: ' ' }, 'Введите имя'],
    [{ birthDate: '2026-02-30' }, 'Неверная дата'],
    [{ birthDate: '2026-10-13' }, 'Дата рождения в будущем'],
    [{ gender: 'x' }, 'Неверный пол'],
    [{ passportSeries: 'A1' }, 'Серия паспорта — 2 буквы'],
    [{ passportNumber: '123456' }, 'Номер паспорта — 7 цифр'],
    [{ pinfl: '1234567890123' }, 'ПИНФЛ — 14 цифр'],
    [{ inn: '12a' }, 'ИНН — только цифры'],
    [{ email: 'mail.ru' }, 'Неверный email'],
    [{ educationLevel: 'phd' }, 'Неверный уровень образования'],
    [{ employmentType: 'XX' }, 'Неверный тип занятости'],
    [{ rate: 0 }, 'Ставка — число больше 0'],
    [{ rate: '1.255' }, 'Ставка — число больше 0'],
    [{ salary: -1 }, 'Оклад — целое число сум'],
    [{ salary: '100.5' }, 'Оклад — целое число сум'],
    [{ experienceMonths: -2 }, 'Стаж — целое число месяцев'],
    [{ status: 'terminated' }, 'Неверный статус'],
  ])('refuses %o', (patch, message) => {
    expect(() => cleanEmployee({ ...ok, ...(patch as object) }, today)).toThrow(message);
  });

  it('checks the work schedule', () => {
    expect(cleanSchedule(null)).toBeNull();
    expect(cleanSchedule({ '1': { start: '09:00', end: '18:00' }, '6': { start: '09:00', end: '14:00' } })).toEqual({ '1': { start: '09:00', end: '18:00' }, '6': { start: '09:00', end: '14:00' } });
    expect(() => cleanSchedule({})).toThrow('Отметьте рабочие дни');
    expect(() => cleanSchedule({ '1': { start: '', end: '18:00' } })).toThrow('Укажите время');
    expect(() => cleanSchedule({ '1': { start: '18:00', end: '09:00' } })).toThrow('Конец должен быть позже начала');
    expect(() => cleanSchedule({ '8': { start: '09:00', end: '18:00' } })).toThrow('Неверный график работы');
    expect(() => cleanSchedule([1])).toThrow('Неверный график работы');
  });

  it('defaults rate to 1 and keeps money as whole so\'m', () => {
    expect(cleanEmployee(ok, today)).toMatchObject({ rate: '1.00', salary: null });
    expect(cleanEmployee({ ...ok, rate: '0,5', salary: '6 000 000' }, today)).toMatchObject({ rate: '0.50', salary: 6000000 });
  });

  it('checks relatives and diplomas', () => {
    expect(cleanRelative({ relation: 'mother', fullName: ' Нишонова ' })).toMatchObject({ relation: 'mother', fullName: 'Нишонова' });
    expect(() => cleanRelative({ relation: 'friend' })).toThrow('Выберите степень родства');
    expect(() => cleanRelative({})).toThrow('Выберите степень родства');
    expect(cleanDiploma({ degree: 'Бакалавр', graduatedYear: '2019' })).toMatchObject({ degree: 'Бакалавр', graduatedYear: 2019 });
    expect(() => cleanDiploma({ degree: 'PhD' })).toThrow('Неверная степень');
    expect(() => cleanDiploma({ status: 'Да' })).toThrow('Неверный статус диплома');
    expect(() => cleanDiploma({ enrolledYear: 1800 })).toThrow('Неверный год');
  });
});
