import { SalesdocClient, SalesdocError } from './salesdoc.client.js';
import type { SalesdocCredentials } from './salesdoc-credentials.store.js';

const creds: SalesdocCredentials = {
  domain: 'demo.salesdoc.io',
  login: 'api_user',
  password: 'secret',
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function loginOk(token: string) {
  return json({ status: true, result: { userId: 'd0_1', token } });
}

/** Every request body the client sent, in order. */
function sentBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.parse((init as RequestInit).body as string),
  );
}

describe('SalesdocClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: SalesdocClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = new SalesdocClient({ get: () => creds });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('logs in once, then sends method, auth and params to /api/v2', async () => {
    fetchMock
      .mockResolvedValueOnce(loginOk('t1'))
      .mockResolvedValueOnce(json({ status: true, result: { cashbox: [] } }))
      .mockResolvedValueOnce(json({ status: true, result: { cashbox: [] } }));

    await client.call('getCashbox', { params: { limit: 1 } });
    await client.call('getCashbox');

    expect(fetchMock.mock.calls[0][0]).toBe('https://demo.salesdoc.io/api/v2');
    const [login, first, second] = sentBodies(fetchMock);
    expect(login).toEqual({
      method: 'login',
      auth: { login: 'api_user', password: 'secret' },
    });
    expect(first).toEqual({
      method: 'getCashbox',
      auth: { userId: 'd0_1', token: 't1' },
      params: { limit: 1 },
    });
    expect(second.auth.token).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shares one login between concurrent calls', async () => {
    // A second login would invalidate the first token (one token per device).
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      return body.method === 'login'
        ? loginOk('t1')
        : json({ status: true, result: {} });
    });

    await Promise.all([client.call('getUnit'), client.call('getBrand')]);

    const logins = sentBodies(fetchMock).filter((b) => b.method === 'login');
    expect(logins).toHaveLength(1);
  });

  it('logs in again and retries once when the token is rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(loginOk('old'))
      .mockResolvedValueOnce(
        json({ status: false, error: { code: 401, message: 'Invalid token' } }),
      )
      .mockResolvedValueOnce(loginOk('new'))
      .mockResolvedValueOnce(json({ status: true, result: { unit: [] } }));

    const res = await client.call('getUnit');

    expect(res.result).toEqual({ unit: [] });
    expect(sentBodies(fetchMock)[3].auth.token).toBe('new');
  });

  it('throws SalesdocError with the envelope code and message', async () => {
    fetchMock
      .mockResolvedValueOnce(loginOk('t1'))
      .mockResolvedValueOnce(
        json({ status: false, error: { code: 403, message: 'Access denied' } }),
      );

    const err = await client.call('getStoreLog').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SalesdocError);
    expect(err).toMatchObject({ code: 403, message: 'Access denied' });
  });

  it('sends the filial when the credentials name one', async () => {
    client = new SalesdocClient({ get: () => ({ ...creds, filialId: 'F1' }) });
    fetchMock
      .mockResolvedValueOnce(loginOk('t1'))
      .mockResolvedValueOnce(json({ status: true, result: {} }));

    await client.call('getAgent');

    expect(sentBodies(fetchMock)[1].filial).toEqual({ filial_id: 'F1' });
  });

  it('fetchAll walks every page until the total is reached', async () => {
    fetchMock
      .mockResolvedValueOnce(loginOk('t1'))
      .mockResolvedValueOnce(
        json({
          status: true,
          result: { payment: [{ id: 1 }, { id: 2 }] },
          pagination: { limit: 2, total: 3, page: 1 },
        }),
      )
      .mockResolvedValueOnce(
        json({
          status: true,
          result: { payment: [{ id: 3 }] },
          pagination: { limit: 2, total: 3, page: 2 },
        }),
      );

    const rows = await client.fetchAll('getPayment', 'payment', { limit: 2 });

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(sentBodies(fetchMock).map((b) => b.params?.page)).toEqual([
      undefined,
      1,
      2,
    ]);
  });
});
