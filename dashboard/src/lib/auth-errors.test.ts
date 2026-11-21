import assert from "node:assert/strict";
import test from "node:test";
import { friendlyAuthError } from "./auth-errors.ts";

test("maps otp failures to plain language", () => {
  assert.equal(friendlyAuthError("Token has expired or is invalid"), "That code has expired. Send a new one.");
  assert.equal(friendlyAuthError("Invalid OTP"), "That code is not right. Check the email and try again.");
  assert.equal(friendlyAuthError("Email rate limit exceeded"), "Please wait a moment before requesting another code.");
  assert.equal(
    friendlyAuthError("User already registered"),
    "An account with this email already exists. Sign in, or reset the password.",
  );
  assert.equal(friendlyAuthError("Database is down"), "Database is down");
});
