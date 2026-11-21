export interface OfflineLine {
  product_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  gst_rate: number;
  unit?: string;
  discount: number;
}

export type QueueStatus = "pending" | "exists" | "conflict";

export interface QueuedSale {
  client_id: string;
  payment_client_id: string;
  created_at: string;
  method: "cash" | "upi";
  tendered: number;
  change_given: number;
  lines: OfflineLine[];
  status: QueueStatus;
  number?: string | null;
  reason?: string | null;
  invoice_id?: string | null;
}

const DB = "billflow-offline";
const STORE = "sales";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "client_id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueSale(sale: QueuedSale) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(sale);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listQueued(): Promise<QueuedSale[]> {
  const db = await openDb();
  const rows = await new Promise<QueuedSale[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result as QueuedSale[]).map((row) => ({ ...row, status: row.status ?? "pending" })));
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function removeQueued(clientIds: string[]) {
  if (!clientIds.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    clientIds.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Body for POST /sync/sales. client_id is the idempotency key. */
export function syncSalesBody(sales: QueuedSale[], deviceId = "dashboard") {
  return {
    device_id: deviceId,
    sales: sales
      .filter((sale) => sale.status === "pending")
      .map((sale) => ({
        client_id: sale.client_id,
        lines: sale.lines.map((line) => ({
          ...(line.product_id ? { product_id: line.product_id } : {}),
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          gst_rate: line.gst_rate,
          ...(line.unit ? { unit: line.unit } : {}),
          discount: line.discount,
        })),
        payments: [
          {
            client_id: sale.payment_client_id,
            method: sale.method,
            amount: sale.tendered - sale.change_given,
            amount_tendered: sale.tendered,
            change_given: sale.change_given,
            paid_at: sale.created_at,
          },
        ],
      })),
  };
}
