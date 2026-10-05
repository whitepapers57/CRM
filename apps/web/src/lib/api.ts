import { redirect } from "next/navigation";
import { getSessionToken } from "./session";

const API_URL = process.env.API_URL ?? "http://localhost:4000/api";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const token = await getSessionToken();
  let res: Response;
  let body: unknown = null;
  try {
    res = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      ...init,
      headers: { ...(init?.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    body = res.status === 204 ? null : await res.json().catch(() => null);
  } catch {
    return { ok: false, status: 0, message: "" };
  }
  // Outside try/catch: redirect() works by throwing.
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    const b = body as { message?: string | string[] } | null;
    const message = Array.isArray(b?.message) ? b.message.join(", ") : b?.message;
    return { ok: false, status: res.status, message: message ?? res.statusText };
  }
  return { ok: true, data: body as T };
}

export const apiGet = <T>(path: string) => request<T>(path);
const withBody = (method: string) => <T>(path: string, body?: unknown) =>
  request<T>(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPost = withBody("POST");
export const apiPut = withBody("PUT");
export const apiDelete = withBody("DELETE");


/** `?from=..&to=..` plus extra params, skipping empty values. */
export function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface Summary {
  period: { from: string; to: string };
  windowStart: string;
  dataAsOf: string | null;
  outlets: { receivable: string; prepaid: string; delivered: string; returned: string; paid: string };
  supplier: { received: string; paid: string; owed: string };
}

export interface OutletBalance {
  outletSdId: string;
  name: string;
  firmName: string | null;
  inn: string | null;
  opening: string;
  delivered: string;
  returned: string;
  paid: string;
  closing: string;
}

export interface StatementRow {
  kind: "order" | "return" | "payment" | "purchase";
  sdId: string;
  date: string;
  amount: string;
  balance: string;
  warehouseName?: string | null;
}

export interface OutletStatement {
  outlet: { sdId: string; name: string; firmName: string | null; inn: string | null };
  opening: string;
  closing: string;
  rows: StatementRow[];
}

export interface SupplierStatement {
  opening: string;
  received: string;
  paid: string;
  closing: string;
  rows: StatementRow[];
}

export interface StockResponse {
  warehouses: Array<{ sdId: string; name: string }>;
  rows: Array<{ warehouseSdId: string; warehouseName: string; productSdId: string; productName: string; quantity: string }>;
}

export interface PurchaseList {
  total: string;
  filters: { suppliers: Array<{ sdId: string; name: string }>; warehouses: Array<{ sdId: string; name: string }> };
  rows: Array<{
    sdId: string;
    date: string;
    warehouseSdId: string | null;
    warehouseName: string | null;
    supplierSdId: string | null;
    supplierName: string | null;
    lineCount: number;
    total: string;
    hidden: { by: string; at: string; reason: string } | null;
  }>;
}

export interface SupplierList {
  rows: Array<{ sdId: string; name: string; received: string; paid: string; debt: string }>;
}

export interface PurchaseDetail {
  sdId: string;
  date: string;
  warehouseSdId: string | null;
  supplierSdId: string | null;
  monthOpen: boolean;
  hidden: { by: string; at: string; reason: string } | null;
  warehouseName: string | null;
  supplierName: string | null;
  total: string;
  lines: Array<{ productSdId: string | null; productName: string; quantity: string; price: string; amount: string }>;
}

export interface SyncStatus {
  running: boolean;
  dataAsOf: string | null;
  resources: Array<{
    resource: string;
    lastSuccessAt: string | null;
    resumePage: number | null;
    lastRun: { status: string; records: number; error: string | null; startedAt: string; finishedAt: string | null } | null;
  }>;
}

export interface MonthRow {
  month: string;
  closed: boolean;
  changedBy: string | null;
  changedAt: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  userName: string;
  action: string;
  target: string;
  reason: string | null;
  before: unknown;
  after: unknown;
}

export interface FormOptions {
  warehouses: Array<{ sdId: string; name: string }>;
  suppliers: Array<{ sdId: string; name: string }>;
  products: Array<{ sdId: string; name: string }>;
}

export interface SalesOrderList {
  total: string;
  filters: { warehouses: Array<{ sdId: string; name: string }>; agents: Array<{ sdId: string; name: string }> };
  rows: Array<{
    sdId: string;
    date: string;
    status: number;
    outletSdId: string | null;
    outletName: string | null;
    warehouseName: string | null;
    agentName: string | null;
    lineCount: number;
    total: string;
  }>;
}

export interface SalesOrder {
  sdId: string;
  date: string;
  status: number;
  outletSdId: string | null;
  outletName: string | null;
  warehouseName: string | null;
  agentName: string | null;
  expeditorName: string | null;
  totalBeforeDiscount: string;
  discount: string;
  returns: string;
  total: string;
  lines: Array<{ productSdId: string | null; productName: string; quantity: string; price: string; discount: string; amount: string; returned: string }>;
}
