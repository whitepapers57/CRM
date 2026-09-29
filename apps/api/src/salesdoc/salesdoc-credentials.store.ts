import { Injectable } from '@nestjs/common';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SalesdocCredentials {
  /** Host of the Salesdoc instance, e.g. "company.salesdoc.io". */
  domain: string;
  login: string;
  password: string;
  /** Filial XML_ID. Omit (or "0") on servers without filials. */
  filialId?: string;
}

export interface CredentialsSource {
  get(): SalesdocCredentials | null;
}

/**
 * Reads data/salesdoc.json (not .env), re-reading it whenever the file
 * changes so new credentials apply without a restart.
 */
@Injectable()
export class SalesdocCredentialsStore implements CredentialsSource {
  private readonly file = resolve(
    process.env.SALESDOC_CREDENTIALS_FILE ?? 'data/salesdoc.json',
  );
  private cache: { mtimeMs: number; value: SalesdocCredentials } | null = null;

  get(): SalesdocCredentials | null {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.file).mtimeMs;
    } catch {
      return null;
    }
    if (this.cache?.mtimeMs === mtimeMs) return this.cache.value;

    const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<
      string,
      unknown
    >;
    const { domain, login, password, filialId } = raw;
    if (
      typeof domain !== 'string' ||
      typeof login !== 'string' ||
      typeof password !== 'string'
    ) {
      throw new Error(`${this.file} needs string "domain", "login", "password"`);
    }
    const value: SalesdocCredentials = {
      domain: domain.replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      login,
      password,
      filialId: typeof filialId === 'string' ? filialId : undefined,
    };
    this.cache = { mtimeMs, value };
    return value;
  }
}
