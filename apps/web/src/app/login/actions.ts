"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, getSessionToken } from "@/lib/session";

const API_URL = process.env.API_URL ?? "http://localhost:4000/api";

/** Returns the typed login with any error, so the form can keep it after React resets it. */
export async function login(
  _: { error?: string; login?: string } | undefined,
  form: FormData,
): Promise<{ error?: string; login?: string }> {
  const typed = String(form.get("login") ?? "");
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: form.get("login"), password: form.get("password") }),
    cache: "no-store",
  }).catch(() => null);
  if (!res) return { error: "api_down", login: typed };
  if (!res.ok) return { error: "bad_login", login: typed };
  const { token } = (await res.json()) as { token: string };
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
  redirect("/");
}

export async function logout() {
  const token = await getSessionToken();
  if (token) {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
