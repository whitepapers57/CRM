import { syncWindow } from './window.js';

describe('syncWindow', () => {
  it('covers the current month and the two before it, in Tashkent days', () => {
    expect(syncWindow(new Date('2026-09-29T08:00:00Z'))).toEqual({
      start: '2026-07-01',
      fetchFrom: '2026-06-24',
      to: '2026-09-29',
    });
  });

  it('moves on the 1st of the month in Tashkent, not in UTC', () => {
    // 30 Sep 20:00 UTC is already 1 Oct 01:00 in Tashkent.
    expect(syncWindow(new Date('2026-09-30T20:00:00Z')).start).toBe('2026-08-01');
    expect(syncWindow(new Date('2026-09-30T18:00:00Z')).start).toBe('2026-07-01');
  });

  it('crosses the year boundary', () => {
    expect(syncWindow(new Date('2027-02-10T08:00:00Z'))).toMatchObject({
      start: '2026-12-01',
      fetchFrom: '2026-11-24',
    });
  });
});
