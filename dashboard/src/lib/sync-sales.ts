import { authed } from "@/lib/api";
import { listQueued, queueSale, syncSalesBody, type QueuedSale } from "@/lib/offline-queue";

export interface SyncSaleResult {
  client_id: string;
  status: "created" | "exists" | "conflict";
  invoice_id?: string;
  number?: string;
  reason?: string;
}

export function offlineSyncEnabled() {
  return process.env.NEXT_PUBLIC_OFFLINE_SYNC !== "0";
}

export function newClientId() {
  return crypto.randomUUID();
}

export function saleFromCart(input: {
  method: "cash" | "upi";
  tendered: number;
  changeGiven: number;
  lines: QueuedSale["lines"];
}): QueuedSale {
  return {
    client_id: newClientId(),
    payment_client_id: newClientId(),
    created_at: new Date().toISOString(),
    method: input.method,
    tendered: input.tendered,
    change_given: input.changeGiven,
    lines: input.lines,
    status: "pending",
    number: null,
  };
}

export async function syncQueuedSales(): Promise<{ updated: SyncSaleResult[]; waiting: boolean; error?: string }> {
  const sales = await listQueued();
  const pending = sales.filter((sale) => sale.status === "pending");
  if (!pending.length) return { updated: [], waiting: sales.some((sale) => sale.status !== "pending") };
  if (!offlineSyncEnabled()) return { updated: [], waiting: true, error: "flag-off" };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { updated: [], waiting: true };
  try {
    const result = await authed<{ results: SyncSaleResult[] }>("/sync/sales", {
      method: "POST",
      body: JSON.stringify(syncSalesBody(sales)),
    });
    for (const row of result.results ?? []) {
      const current = sales.find((sale) => sale.client_id === row.client_id);
      if (!current) continue;
      await queueSale({
        ...current,
        status: row.status === "created" ? "exists" : row.status,
        number: row.number ?? current.number ?? null,
        invoice_id: row.invoice_id ?? current.invoice_id ?? null,
        reason: row.reason ?? null,
      });
    }
    return { updated: result.results ?? [], waiting: true };
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "sync failed";
    const missing = /no openapi route|not found|404|cannot post|schema cache|does not exist/i.test(message);
    return { updated: [], waiting: true, error: missing ? "missing" : message };
  }
}
