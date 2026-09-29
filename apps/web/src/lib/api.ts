const API_URL = process.env.API_URL ?? "http://localhost:4000/api";

/** Server-side GET against the NestJS API; null when it is unreachable. */
export async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface HealthStatus {
  ok: boolean;
  database: "up" | "down";
}

export interface SalesdocStatus {
  configured: boolean;
  connected: boolean;
  userId?: string;
  error?: { code?: number; message: string };
}
