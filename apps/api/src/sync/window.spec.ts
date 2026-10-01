import { syncWindow } from './window.js';

describe('syncWindow', () => {
  it('covers only the current month, in Tashkent days', () => {
    expect(syncWindow(new Date('2026-09-29T08:00:00Z'))).toEqual({
      start: '2026-09-01',
      fetchFrom: '2026-08-25',
      to: '2026-09-29',
    });
  });

  it('moves on the 1st of the month in Tashkent, not in UTC', () => {
    // 30 Sep 20:00 UTC is already 1 Oct 01:00 in Tashkent.
    expect(syncWindow(new Date('2026-09-30T20:00:00Z')).start).toBe('2026-10-01');
    expect(syncWindow(new Date('2026-09-30T18:00:00Z')).start).toBe('2026-09-01');
  });

  it('crosses the year boundary', () => {
    expect(syncWindow(new Date('2027-01-10T08:00:00Z'))).toMatchObject({
      start: '2027-01-01',
      fetchFrom: '2026-12-25',
    });
  });
});
