import assert from "node:assert/strict";
import test from "node:test";
import { syncSalesBody, type QueuedSale } from "./offline-queue.ts";

test("sync body keeps the client id for an idempotent retry", () => {
  const sale: QueuedSale = {
    client_id: "6f1e2c4a-9b3d-4e5f-8a71-2c0b9d4e6a11",
    payment_client_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    created_at: "2026-11-20T12:00:00.000Z",
    method: "cash",
    tendered: 118,
    change_given: 18,
    lines: [{ description: "Tea", quantity: 2, unit_price: 50, gst_rate: 5, discount: 0 }],
    status: "pending",
  };
  const body = syncSalesBody([sale, { ...sale, client_id: "11111111-2222-4333-8444-555555555555", status: "conflict" }]);
  assert.equal(body.device_id, "dashboard");
  assert.equal(body.sales.length, 1);
  assert.equal(body.sales[0].client_id, sale.client_id);
  assert.equal(body.sales[0].payments[0].client_id, sale.payment_client_id);
  assert.equal(body.sales[0].payments[0].amount, 100);
  assert.equal(body.sales[0].lines[0].quantity, 2);
});
