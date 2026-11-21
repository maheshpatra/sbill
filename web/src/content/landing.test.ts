import assert from "node:assert/strict";
import test from "node:test";
import { landing } from "./landing.ts";
import { formatInr, pricing, yearlyPrice } from "../config/pricing.ts";

test("hero and closing lines stay on the approved copy", () => {
  assert.equal(landing.headline, "Get paid faster. Stress less about billing.");
  assert.equal(landing.primaryCta, "Start free, no card needed.");
  assert.equal(landing.features.length, 7);
  assert.equal(landing.faq.length, 5);
  assert.match(landing.about, /Genesix Solution Pvt Ltd/);
  assert.match(landing.shortDescription, /Start free\.$/);
});

test("yearly billing saves two months", () => {
  assert.equal(yearlyPrice(0), 0);
  assert.equal(yearlyPrice(199), 1990);
  assert.equal(yearlyPrice(499), 4990);
  assert.equal(yearlyPrice(1499), 14990);
  assert.equal(pricing.plans.map((plan) => plan.name).join(","), "Free,Starter,Growth,Business");
  assert.equal(pricing.plans[0].monthlyPrice, 0);
  assert.equal(pricing.plans[2].monthlyPrice, 499);
  assert.equal(formatInr(499), "₹499");
});
