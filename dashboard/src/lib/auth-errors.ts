/** Turn Supabase Auth messages into something a person can act on. */
export function friendlyAuthError(message: string) {
  const text = message.toLowerCase();
  if (text.includes("expired")) return "That code has expired. Send a new one.";
  if (
    (text.includes("invalid") || text.includes("otp")) &&
    (text.includes("token") || text.includes("otp") || text.includes("code"))
  ) {
    return "That code is not right. Check the email and try again.";
  }
  if (text.includes("rate limit") || text.includes("too many") || text.includes("once every") || text.includes("security purposes")) {
    return "Please wait a moment before requesting another code.";
  }
  if (text.includes("already registered") || text.includes("already been registered")) {
    return "An account with this email already exists. Sign in, or reset the password.";
  }
  if (text.includes("password") && text.includes("at least")) return "Use a password of at least 8 characters.";
  return message;
}
