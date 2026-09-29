import { parseSdDate, tashkentDay } from './salesdoc-date.js';

describe('parseSdDate', () => {
  it('keeps the wall-clock time as UTC', () => {
    expect(parseSdDate('2026-09-28 15:52:51')?.toISOString()).toBe(
      '2026-09-28T15:52:51.000Z',
    );
  });
  it('accepts a bare date', () => {
    expect(parseSdDate('2022-11-10')?.toISOString()).toBe(
      '2022-11-10T00:00:00.000Z',
    );
  });
  it('treats empty and 1970-01-01 as no date', () => {
    expect(parseSdDate(null)).toBeNull();
    expect(parseSdDate('')).toBeNull();
    expect(parseSdDate('1970-01-01')).toBeNull();
  });
  it('throws on garbage', () => {
    expect(() => parseSdDate('yesterday')).toThrow('Bad Salesdoc date');
  });
});

describe('tashkentDay', () => {
  it('uses the Tashkent calendar day (UTC+5)', () => {
    expect(tashkentDay(new Date('2026-09-28T20:00:00Z'))).toBe('2026-09-29');
    expect(tashkentDay(new Date('2026-09-28T18:59:00Z'))).toBe('2026-09-28');
  });
});
