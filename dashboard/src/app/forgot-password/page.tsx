"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FirstRun } from "@/components/intro-slides";
import { OtpInput, useCooldown } from "@/components/otp-input";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { friendlyAuthError } from "@/lib/auth-errors";
import { authRedirectUrl, getSupabase, supabaseConfigured } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  return (
    <FirstRun>
      <ForgotPasswordForm />
    </FirstRun>
  );
}

function ForgotPasswordForm() {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code" | "password">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cooldown = useCooldown(60);

  function requireConfig() {
    if (supabaseConfigured()) return true;
    setError("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to dashboard/.env.local.");
    return false;
  }

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    setNotice(null);
    if (!requireConfig()) return;
    setPending(true);
    const { error: resetError } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectUrl(),
    });
    setPending(false);
    if (resetError) {
      setError(friendlyAuthError(resetError.message));
      return;
    }
    setStep("code");
    cooldown.start();
    setNotice("We emailed a 6-digit code. It is valid for 60 minutes.");
  }

  async function resend() {
    if (cooldown.left > 0) return;
    await sendCode();
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
    const { error: verifyError } = await getSupabase().auth.verifyOtp({ email, token: code, type: "recovery" });
    setPending(false);
    if (verifyError) {
      setError(friendlyAuthError(verifyError.message));
      return;
    }
    setNotice(null);
    setStep("password");
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use a password of at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    if (!requireConfig()) return;
    setPending(true);
    const { error: updateError } = await getSupabase().auth.updateUser({ password });
    setPending(false);
    if (updateError) {
      setError(friendlyAuthError(updateError.message));
      return;
    }
    router.replace("/");
  }

  const title = step === "email" ? "Forgot password" : step === "code" ? "Enter the code" : "Choose a new password";
  const body =
    step === "email"
      ? "We’ll email a 6-digit code. It stays valid for 60 minutes."
      : step === "code"
        ? `Sent to ${email}.`
        : "Use at least 8 characters.";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <img src="/brand/billflow-logo-horizontal.svg" alt="billflow" width={180} height={36} />
      <h1 className="mt-8 text-3xl font-bold tracking-tight text-navy">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
      {step === "email" ? (
        <form onSubmit={sendCode} className="mt-8 space-y-4">
          <Field label="Email">
            <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          {error ? <ErrorNote message={error} /> : null}
          <Button type="submit" className="w-full" loading={pending}>
            {pending ? "Sending code…" : "Email me a code"}
          </Button>
        </form>
      ) : null}
      {step === "code" ? (
        <form onSubmit={verify} className="mt-8 space-y-4">
          <OtpInput value={code} onChange={setCode} disabled={pending} />
          {error ? <ErrorNote message={error} /> : null}
          {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm text-navy">{notice}</p> : null}
          <Button type="submit" className="w-full" loading={pending}>
            {pending ? "Checking code…" : "Continue"}
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
      ) : null}
      {step === "password" ? (
        <form onSubmit={savePassword} className="mt-8 space-y-4">
          <Field label="New password" hint="At least 8 characters.">
            <input className={inputClass} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Field label="Confirm password">
            <input className={inputClass} type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </Field>
          {error ? <ErrorNote message={error} /> : null}
          <Button type="submit" className="w-full" loading={pending}>
            {pending ? "Saving password…" : "Save password"}
          </Button>
        </form>
      ) : null}
      <p className="mt-6 text-sm text-slate-600">
        <Link className="font-semibold text-navy underline" href="/login">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
