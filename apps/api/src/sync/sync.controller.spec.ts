import { SyncController } from './sync.controller.js';
import type { SyncService } from './sync.service.js';

/** A service whose runs never finish, like a long full load. */
function neverEnding(running = false) {
  const calls: string[] = [];
  const service = {
    isRunning: () => running,
    run: (kind: string) => {
      calls.push(kind);
      return new Promise(() => {});
    },
  } as unknown as SyncService;
  return { service, calls };
}

describe('SyncController', () => {
  it('starts a run and answers at once instead of waiting for it', async () => {
    // Review finding: the button waited for the whole run and timed out at 300 s.
    const { service, calls } = neverEnding();
    const answer = await Promise.race([
      new SyncController(service).run({ kind: 'full' }),
      new Promise((r) => setTimeout(() => r('still waiting'), 200)),
    ]);
    expect(answer).toEqual({ started: true, kind: 'full' });
    expect(calls).toEqual(['full']);
  });

  it('says so when an incremental run is already going', async () => {
    const { service, calls } = neverEnding(true);
    expect(await new SyncController(service).run({})).toEqual({ alreadyRunning: true });
    expect(calls).toEqual([]);
  });
});
