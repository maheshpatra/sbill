"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";
import { Button, ErrorNote, Field, inputClass } from "./ui";

export function AuthCard({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const configured = supabaseConfigured();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!configured) {
      setError("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to dashboard/.env.local.");
      return;
    }
    setPending(true);
    const supabase = getSupabase();
    const result =
      mode === "signup"
        ? await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:4319"}/auth/callback` },
          })
        : await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (mode === "signup" && !result.data.session) {
      setNotice("Check your email to confirm the account, then sign in.");
      return;
    }
    router.replace("/");
  }

  async function magicLink() {
    setError(null);
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    if (!configured) return;
    setPending(true);
    const { error: otpError } = await getSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:4319"}/auth/callback` },
    });
    setPending(false);
    if (otpError) setError(otpError.message);
    else setNotice("Sign-in link sent. Open it on this device.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <img src="/brand/billflow-logo-horizontal.svg" alt="billflow" width={180} height={36} />
      <h1 className="mt-8 text-3xl font-bold tracking-tight text-navy">
        {mode === "login" ? "Sign in" : "Create your account"}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {mode === "login" ? "Use the email you signed up with." : "Then you’ll name your business and start invoicing."}
      </p>
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
        {error ? <ErrorNote message={error} /> : null}
        {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm text-navy">{notice}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <button type="button" className="mt-4 text-sm font-semibold text-teal-800 underline" onClick={() => void magicLink()}>
        Email me a sign-in link
      </button>
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
