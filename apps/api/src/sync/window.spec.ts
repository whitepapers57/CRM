import { syncWindow } from './window.js';

describe('syncWindow', () => {
  it('starts on 1 Sep 2026 and runs to today, in Tashkent days', () => {
    expect(syncWindow(new Date('2026-10-01T08:00:00Z'))).toEqual({
      start: '2026-09-01',
      fetchFrom: '2026-08-25',
      to: '2026-10-01',
    });
  });

  it('keeps growing: nothing before 1 Sep is dropped later in the year', () => {
    expect(syncWindow(new Date('2027-02-10T08:00:00Z'))).toEqual({
      start: '2026-09-01',
      fetchFrom: '2026-08-25',
      to: '2027-02-10',
    });
  });

  it('uses the Tashkent calendar day for today', () => {
    // 30 Sep 20:00 UTC is already 1 Oct in Tashkent.
    expect(syncWindow(new Date('2026-09-30T20:00:00Z')).to).toBe('2026-10-01');
  });
});
