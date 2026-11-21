import assert from "node:assert/strict";
import test from "node:test";
import { canAdmin, canWrite } from "./access.ts";

test("members are read-only and billing can write", () => {
  assert.equal(canWrite("member"), false);
  assert.equal(canAdmin("member"), false);
  assert.equal(canWrite("billing"), true);
  assert.equal(canAdmin("billing"), false);
  assert.equal(canAdmin("owner"), true);
  assert.equal(canWrite(null), false);
});
