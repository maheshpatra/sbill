import { createBillflowClient, type BillflowPaths } from "@billflow/api-client";
import type { Client } from "openapi-fetch";
import { getSupabase } from "./supabase";

export class ApiError extends Error {
  status: number;
  code?: string;
  feature?: string;
  requiredPlan?: string;

  constructor(
    status: number,
    message: string,
    extra?: { code?: string; feature?: string; requiredPlan?: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = extra?.code;
    this.feature = extra?.feature;
    this.requiredPlan = extra?.requiredPlan;
  }
}

type ErrorListener = (error: ApiError) => void;
let listener: ErrorListener | null = null;

export function setApiErrorListener(next: ErrorListener | null) {
  listener = next;
}

export function apiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4317").replace(/\/$/, "");
}

/** Typed client from the OpenAPI spec. Pass the Supabase access token for protected routes. */
export function billflowClient(token?: string): Client<BillflowPaths> {
  return createBillflowClient({ baseUrl: apiBase(), token });
}

/** Path templates from packages/api-client. Longer static matches win. */
const PATH_TEMPLATES = [
  "/health",
  "/auth/me",
  "/me",
  "/uploads/presign",
  "/invoice-templates",
  "/admin/plans",
  "/admin/plans/{code}",
  "/admin/plans/{code}/features",
  "/admin/templates",
  "/admin/templates/{key}",
  "/admin/tenants",
  "/admin/tenants/{id}/suspend",
  "/admin/tenants/{id}/plan",
  "/admin/settings",
  "/tenants",
  "/tenants/current",
  "/tenants/switch",
  "/tenants/members",
  "/tenants/members/{id}",
  "/entitlements",
  "/billing/plans",
  "/billing/subscription",
  "/billing/invoices",
  "/billing/checkout",
  "/billing/subscription/cancel",
  "/public/billing/razorpay",
  "/customers",
  "/customers/{id}",
  "/invoices",
  "/invoices/{id}",
  "/invoices/{id}/send",
  "/invoices/{id}/void",
  "/invoices/{id}/mark-paid",
  "/invoices/{id}/upi",
  "/payments",
  "/payments/{id}",
  "/payments/{id}/confirm",
  "/payments/{id}/void",
  "/payments/{id}/razorpay/verify",
  "/payments/{id}/refund",
  "/invoices/{id}/razorpay",
  "/settings/razorpay",
  "/settings/razorpay/test",
  "/public/payments/razorpay/{tenantId}",
  "/webhooks",
  "/webhooks/{id}",
  "/webhooks/{id}/deliveries",
  "/tax-rates",
  "/tax-rates/{id}",
  "/sites/resolve",
  "/sites/current",
  "/website/templates",
  "/website",
  "/website/template",
  "/website/draft",
  "/website/publish",
  "/website/subdomain",
  "/website/domains",
  "/website/domains/{id}/verify",
  "/website/domains/{id}",
  "/internal/cron/mark-overdue",
  "/invoices/{id}/share",
  "/invoices/{id}/share/revoke",
  "/public/invoices/{token}",
  "/invoices/{id}/pdf",
  "/invoices/{id}/whatsapp",
  "/invoices/{id}/credit-note",
  "/invoices/{id}/einvoice",
  "/gstin/validate",
  "/reports/gstr1",
  "/public/whatsapp/webhook",
  "/settings/whatsapp",
  "/reminders/schedules",
  "/reminders/jobs",
  "/internal/cron/reminders",
  "/products",
  "/products/{id}",
  "/pos/settings",
  "/pos/checkout",
  "/pos/tiles",
  "/dashboard/morning",
  "/invoices/{id}/events",
  "/reminders/plan",
  "/customers/{id}/ledger-link",
  "/customers/{id}/ledger-link/revoke",
  "/public/ledger/{token}",
  "/public/ledger/{token}/upi",
  "/voice/parse",
  "/purchases",
  "/purchases/parse",
  "/product-categories",
  "/product-categories/{id}",
  "/i18n/labels",
  "/settings/messaging",
  "/sync/sales",
] as const;

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ErrorBody {
  message?: string | string[];
  code?: string;
  feature?: string;
  required_plan?: string;
}

export const NOT_IN_THIS_ENVIRONMENT = "Not available in this environment.";

function toApiError(status: number, statusText: string, body: ErrorBody) {
  let message = Array.isArray(body.message) ? body.message.join(" ") : body.message || statusText;
  if (body.code === "BILLING_NOT_CONFIGURED") {
    message = "Online payments are not configured yet.";
  }
  if (body.code === "STORAGE_NOT_CONFIGURED") {
    message = "Storage is not set up yet.";
  }
  const error = new ApiError(status, message, {
    code: body.code,
    feature: body.feature,
    requiredPlan: body.required_plan,
  });
  if (error.code === "FEATURE_LOCKED" || error.code === "LIMIT_REACHED") listener?.(error);
  return error;
}

/** Routes that still read or write secrets with the service role. */
function needsServiceRole(pathname: string, method: string, body: unknown) {
  if (method === "PUT" && pathname === "/settings/razorpay") return true;
  if (method === "POST" && pathname === "/settings/razorpay/test") return true;
  if (method === "POST" && /\/invoices\/[^/]+\/razorpay$/.test(pathname)) return true;
  if (method === "POST" && /\/payments\/[^/]+\/razorpay\/verify$/.test(pathname)) return true;
  if (method === "POST" && /\/payments\/[^/]+\/refund$/.test(pathname)) return true;
  if (method === "POST" && /\/invoices\/[^/]+\/whatsapp$/.test(pathname)) return true;
  if (method !== "GET" && pathname.startsWith("/webhooks")) return true;
  if (method === "POST" && pathname === "/pos/checkout") {
    const pay = body && typeof body === "object" && "method" in body ? String((body as { method?: string }).method) : "";
    return pay === "razorpay";
  }
  return false;
}

function presentError(path: string, method: string, body: unknown, error: ApiError) {
  const pathname = path.split("?")[0];
  if (needsServiceRole(pathname, method, body) && /invalid api key|payment_secrets_key/i.test(error.message)) {
    error.message = NOT_IN_THIS_ENVIRONMENT;
  }
  return error;
}

function matchTemplate(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  let best: { template: string; path: Record<string, string>; score: number } | null = null;
  for (const template of PATH_TEMPLATES) {
    const segments = template.split("/").filter(Boolean);
    if (segments.length !== parts.length) continue;
    const path: Record<string, string> = {};
    let score = 0;
    let ok = true;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment.startsWith("{") && segment.endsWith("}")) {
        path[segment.slice(1, -1)] = decodeURIComponent(parts[index]);
      } else if (segment === parts[index]) {
        score += 2;
      } else {
        ok = false;
        break;
      }
    }
    if (ok && (!best || score > best.score)) best = { template, path, score };
  }
  return best;
}

function queryFrom(url: URL) {
  const query: Record<string, string | number> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = key === "page" || key === "limit" ? Number(value) : value;
  });
  return query;
}

async function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): Promise<T> {
  if (!result.response.ok) {
    const body =
      result.error && typeof result.error === "object"
        ? (result.error as ErrorBody)
        : ((await result.response.clone().json().catch(() => ({}))) as ErrorBody);
    throw toApiError(result.response.status, result.response.statusText, body);
  }
  if (result.data !== undefined && result.data !== null) return result.data;
  if (result.response.status === 204) return undefined as T;
  const text = await result.response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function accessToken() {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "Sign in again.");
  return token;
}

async function callPath<T>(path: string, token: string, init?: RequestInit, parseAs: "json" | "blob" = "json"): Promise<T> {
  const url = new URL(path, "http://billflow.local");
  const matched = matchTemplate(url.pathname);
  if (!matched) {
    throw new ApiError(404, `No OpenAPI route for ${url.pathname}`);
  }
  const method = ((init?.method ?? "GET").toUpperCase() || "GET") as HttpMethod;
  const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
  const client = billflowClient(token);
  const operation = client[method] as (
    template: string,
    init: { params: { path: Record<string, string>; query: Record<string, string | number> }; body?: unknown; parseAs: "json" | "blob" },
  ) => Promise<{ data?: T; error?: unknown; response: Response }>;
  const result = await operation(matched.template, {
    params: {
      path: matched.path,
      query: queryFrom(url),
    },
    body,
    parseAs,
  });
  try {
    return await unwrap(result as { data?: T; error?: unknown; response: Response });
  } catch (error) {
    if (error instanceof ApiError) throw presentError(url.pathname, method, body, error);
    throw error;
  }
}

/** Authenticated JSON call through the generated OpenAPI client. */
export async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  return callPath<T>(path, await accessToken(), init, "json");
}

/** Invoice PDF. The spec lists the route; the body is binary. */
export async function authedBlob(path: string): Promise<Blob> {
  return callPath<Blob>(path, await accessToken(), undefined, "blob");
}

/**
 * Run a typed OpenAPI call. Many success responses omit a JSON schema,
 * so an empty `data` falls back to the response body.
 */
export async function callBillflow<T>(
  run: (client: Client<BillflowPaths>) => Promise<{ data?: T; error?: unknown; response: Response }>,
  token?: string,
): Promise<T> {
  const auth = token ?? (await accessToken());
  return unwrap(await run(billflowClient(auth)));
}
