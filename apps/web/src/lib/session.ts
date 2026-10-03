import { cookies } from "next/headers";

export const SESSION_COOKIE = "df_session";
const API_URL = process.env.API_URL ?? "http://localhost:4000/api";

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** The logged-in user, or null. Never redirects (the login page uses it too). */
export async function getMe(): Promise<{ id: string; login: string; name: string } | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_URL}/auth/me`, { cache: "no-store", headers: { authorization: `Bearer ${token}` } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
