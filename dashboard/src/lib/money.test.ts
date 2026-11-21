import assert from "node:assert/strict";
import test from "node:test";
import { inr, inrTight, num, slugify } from "./money.ts";

test("formats rupees and slugs", () => {
  assert.equal(num("1180.50"), 1180.5);
  assert.equal(num("nope"), 0);
  assert.equal(inr(23600), "₹23,600.00");
  assert.equal(inrTight(5900), "₹5,900");
  assert.equal(inrTight(24100), "₹24,100");
  assert.equal(inrTight(50.5), "₹50.50");
  assert.equal(slugify("Acme Traders!"), "acme-traders");
});
