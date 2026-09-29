import { Inject, Injectable } from '@nestjs/common';
import {
  SalesdocCredentialsStore,
  type CredentialsSource,
  type SalesdocCredentials,
} from './salesdoc-credentials.store.js';

/** Envelope shared by every Salesdoc API V2 response. */
export interface SalesdocResponse<T = Record<string, unknown>> {
  status: boolean;
  result: T;
  pagination?: { limit: number; total: number; page: number };
  error?: { code: number; message: string; data?: unknown };
}

export interface SalesdocParams {
  limit?: number;
  page?: number;
  period?: { from: string; to: string; by: 'create' | 'update' };
  sort?: { by: 'create' | 'update'; order: 'ASC' | 'DESC' };
  filter?: Record<string, unknown>;
}

export interface SalesdocCallOptions {
  params?: SalesdocParams;
  data?: unknown;
  /** Overrides the filial from the credentials file. */
  filialId?: string;
}

export class SalesdocError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'SalesdocError';
  }
}

interface Session {
  key: string;
  userId: string;
  token: string;
}

/**
 * Salesdoc API V2: a single POST endpoint, method named in the body.
 * https://github.com/Clever91/salesdoc-api-doc
 *
 * A token is valid for one "device" only — every login invalidates the
 * previous token — so the client keeps one session and never logs in twice
 * at the same time.
 */
@Injectable()
export class SalesdocClient {
  private session: Session | null = null;
  private pendingLogin: Promise<Session> | null = null;

  constructor(
    @Inject(SalesdocCredentialsStore)
    private readonly credentials: CredentialsSource,
  ) {}

  async call<T = Record<string, unknown>>(
    method: string,
    options: SalesdocCallOptions = {},
  ): Promise<SalesdocResponse<T>> {
    const creds = this.requireCredentials();
    let session = await this.getSession(creds);
    let res = await this.send<T>(creds, method, session, options);

    if (!res.status && res.error?.code === 401) {
      session = await this.getSession(creds, session.token);
      res = await this.send<T>(creds, method, session, options);
    }
    if (!res.status) {
      throw new SalesdocError(
        res.error?.code ?? 0,
        res.error?.message ?? `Salesdoc ${method} failed`,
        res.error?.data,
      );
    }
    return res;
  }

  /** Reads every page of a GET method and returns `result[resultKey]` rows. */
  async fetchAll<Row = Record<string, unknown>>(
    method: string,
    resultKey: string,
    params: SalesdocParams = {},
    filialId?: string,
  ): Promise<Row[]> {
    const limit = params.limit ?? 1000;
    const rows: Row[] = [];
    for (let page = params.page ?? 1; ; page++) {
      const res = await this.call<Record<string, Row[] | undefined>>(method, {
        params: { ...params, limit, page },
        filialId,
      });
      const batch = res.result[resultKey] ?? [];
      rows.push(...batch);
      const total = res.pagination?.total ?? rows.length;
      if (batch.length === 0 || page * limit >= total) return rows;
    }
  }

  /** Logs in (if needed) and returns the Salesdoc user id; for status checks. */
  async connect(): Promise<{ userId: string }> {
    const session = await this.getSession(this.requireCredentials());
    return { userId: session.userId };
  }

  isConfigured(): boolean {
    return this.credentials.get() !== null;
  }

  private requireCredentials(): SalesdocCredentials {
    const creds = this.credentials.get();
    if (!creds) {
      throw new SalesdocError(0, 'Salesdoc credentials are not configured');
    }
    return creds;
  }

  /** `staleToken`: the token the server just rejected, forcing a new login. */
  private async getSession(
    creds: SalesdocCredentials,
    staleToken?: string,
  ): Promise<Session> {
    const key = `${creds.domain}|${creds.login}`;
    if (this.session && (this.session.key !== key || this.session.token === staleToken)) {
      this.session = null;
    }
    if (this.session) return this.session;

    this.pendingLogin ??= this.login(creds, key).finally(() => {
      this.pendingLogin = null;
    });
    this.session = await this.pendingLogin;
    return this.session;
  }

  private async login(creds: SalesdocCredentials, key: string): Promise<Session> {
    const res = await this.post<{ userId: string; token: string }>(creds, {
      method: 'login',
      auth: { login: creds.login, password: creds.password },
    });
    if (!res.status) {
      throw new SalesdocError(
        res.error?.code ?? 401,
        res.error?.message ?? 'Salesdoc login failed',
      );
    }
    return { key, userId: res.result.userId, token: res.result.token };
  }

  private send<T>(
    creds: SalesdocCredentials,
    method: string,
    session: Session,
    { params, data, filialId }: SalesdocCallOptions,
  ) {
    const filial = filialId ?? creds.filialId;
    return this.post<T>(creds, {
      method,
      auth: { userId: session.userId, token: session.token },
      ...(filial ? { filial: { filial_id: filial } } : {}),
      ...(params ? { params } : {}),
      ...(data !== undefined ? { data } : {}),
    });
  }

  private async post<T>(
    creds: SalesdocCredentials,
    body: Record<string, unknown>,
  ): Promise<SalesdocResponse<T>> {
    const res = await fetch(`https://${creds.domain}/api/v2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as SalesdocResponse<T>;
    } catch {
      throw new SalesdocError(
        res.status,
        `Salesdoc returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`,
      );
    }
  }
}
