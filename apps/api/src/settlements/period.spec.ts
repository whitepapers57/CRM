import { parsePeriod } from './period.js';

describe('parsePeriod', () => {
  it('defaults to the current month up to today', () => {
    const p = parsePeriod(undefined, undefined, '2026-09-29');
    expect(p.fromDay).toBe('2026-09-01');
    expect(p.toDay).toBe('2026-09-29');
    expect(p.toExclusive.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(p.toExclusiveDay).toBe('2026-09-30');
  });
  it('rejects an impossible date', () => {
    expect(() => parsePeriod('2026-13-01', '2026-09-29', '2026-09-29')).toThrow('from must be a date');
  });
  it('rejects from after to', () => {
    expect(() => parsePeriod('2026-09-30', '2026-09-01', '2026-09-29')).toThrow('from must not be after to');
  });

  it('refuses a start before the stored window', () => {
    expect(() => parsePeriod('2026-08-31', '2026-09-29', '2026-09-29')).toThrow(
      'from must not be before 2026-09-01',
    );
    expect(parsePeriod('2026-09-01', '2026-09-29', '2026-09-29').windowStart).toBe('2026-09-01');
  });
});
