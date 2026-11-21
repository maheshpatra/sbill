import assert from "node:assert/strict";
import test from "node:test";
import { CashPaymentError, settleCash } from "./cash.ts";

test("cash at the counter must cover the bill", () => {
  const full = settleCash({ due: 236, tendered: 500, allowPartial: false });
  assert.equal(full.applied, 236);
  assert.equal(full.changeGiven, 264);
  assert.throws(() => settleCash({ due: 236, tendered: 100, allowPartial: false }), CashPaymentError);
});

test("an invoice can take a part of the cash", () => {
  const part = settleCash({ due: 236, tendered: 100, changeGiven: 0, allowPartial: true });
  assert.equal(part.applied, 100);
});
