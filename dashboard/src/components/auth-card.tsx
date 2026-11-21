"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { friendlyAuthError } from "@/lib/auth-errors";
import { authRedirectUrl, getSupabase, supabaseConfigured } from "@/lib/supabase";
import { OtpInput, useCooldown } from "./otp-input";
import { Button, ErrorNote, Field, inputClass } from "./ui";

export function AuthCard({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [step, setStep] = useState<"credentials" | "verify">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cooldown = useCooldown(60);
  const configured = supabaseConfigured();

  function requireConfig() {
    if (configured) return true;
    setError("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to dashboard/.env.local.");
    return false;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!requireConfig()) return;
    setPending(true);
    const supabase = getSupabase();
    const result =
      mode === "signup"
        ? await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: authRedirectUrl() },
          })
        : await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (result.error) {
      setError(friendlyAuthError(result.error.message));
      return;
    }
    if (mode === "signup" && !result.data.session) {
      setStep("verify");
      setCode("");
      cooldown.start();
      setNotice("We emailed a 6-digit code. It is valid for 60 minutes.");
      return;
    }
    router.replace("/");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    if (!requireConfig()) return;
    setPending(true);
    const supabase = getSupabase();
    const signup = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
    let result = signup;
    const wrongType = signup.error && /type/i.test(signup.error.message) && !/expired/i.test(signup.error.message);
    if (wrongType) result = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setPending(false);
    if (result.error) {
      setError(friendlyAuthError(result.error.message));
      return;
    }
    router.replace("/");
  }

  async function resend() {
    setError(null);
    if (cooldown.left > 0 || !requireConfig()) return;
    setPending(true);
    const { error: resendError } = await getSupabase().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    setPending(false);
    if (resendError) {
      setError(friendlyAuthError(resendError.message));
      return;
    }
    cooldown.start();
    setNotice("A new code is on its way.");
  }

  async function magicLink() {
    setError(null);
    setNotice(null);
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    if (!requireConfig()) return;
    setPending(true);
    const { error: otpError } = await getSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    });
    setPending(false);
    if (otpError) setError(friendlyAuthError(otpError.message));
    else setNotice("Sign-in link sent. Open it on this device.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <img src="/brand/billflow-logo-horizontal.svg" alt="billflow" width={180} height={36} />
      <h1 className="mt-8 text-3xl font-bold tracking-tight text-navy">
        {step === "verify" ? "Check your email" : mode === "login" ? "Sign in" : "Create your account"}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {step === "verify"
          ? `Enter the 6-digit code sent to ${email}.`
          : mode === "login"
            ? "Use the email you signed up with."
            : "We’ll email a 6-digit code to confirm this address. Then you’ll name your business."}
      </p>
      {step === "verify" ? (
        <form onSubmit={verify} className="mt-8 space-y-4">
          <OtpInput value={code} onChange={setCode} disabled={pending} />
          {error ? <ErrorNote message={error} /> : null}
          {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm text-navy">{notice}</p> : null}
          <Button type="submit" className="w-full" loading={pending}>
            {pending ? "Checking code…" : "Verify email"}
          </Button>
          <button
            type="button"
            className="text-sm font-semibold text-teal-800 underline disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending || cooldown.left > 0}
            onClick={() => void resend()}
          >
            {cooldown.left > 0 ? `Resend code in ${cooldown.left}s` : "Resend code"}
          </button>
        </form>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <Field label="Email">
            <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <input
              className={inputClass}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {mode === "login" ? (
            <p className="text-right text-sm">
              <Link className="font-semibold text-teal-800 underline" href="/forgot-password">
                Forgot password?
              </Link>
            </p>
          ) : null}
          {error ? <ErrorNote message={error} /> : null}
          {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm text-navy">{notice}</p> : null}
          <Button type="submit" className="w-full" loading={pending}>
            {pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
      )}
      {step === "credentials" ? (
        <button type="button" className="mt-4 text-sm font-semibold text-teal-800 underline disabled:opacity-50" disabled={pending} onClick={() => void magicLink()}>
          Email me a sign-in link
        </button>
      ) : null}
      <p className="mt-6 text-sm text-slate-600">
        {mode === "login" ? (
          <>
            New to billflow? <Link className="font-semibold text-navy underline" href="/signup">Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link className="font-semibold text-navy underline" href="/login">Sign in</Link>
          </>
        )}
      </p>
    </main>
  );
}
