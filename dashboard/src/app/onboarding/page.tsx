"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorNote, Field, inputClass, Loading } from "@/components/ui";
import { callBillflow } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { slugify } from "@/lib/money";
import { getSupabase } from "@/lib/supabase";

export default function OnboardingPage() {
  const { ready, session } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  if (!ready || !session) return <Loading label="Checking your session" />;

  async function createTenant(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await callBillflow((client) =>
        client.POST("/tenants", {
          body: { name: name.trim(), slug },
          parseAs: "json",
        }),
      );
      await getSupabase().auth.refreshSession();
      router.replace("/");
    } catch (reason) {
      setPending(false);
      setError(reason instanceof Error ? reason.message : "Could not create the business");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <img src="/brand/billflow-logo-horizontal.svg" alt="billflow" width={168} height={34} />
      <h1 className="mt-8 text-3xl font-bold tracking-tight text-navy">Name your business</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        This creates your tenant and makes you the owner. You can invite the rest of the team from Settings.
      </p>
      <form className="mt-8 space-y-4" onSubmit={createTenant}>
        <Field label="Business name">
          <input
            className={inputClass}
            required
            minLength={2}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!touched) setSlug(slugify(event.target.value));
            }}
          />
        </Field>
        <Field label="Site slug" hint="Lowercase. This becomes your public address, like acme.billflow.com.">
          <input
            className={inputClass}
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            value={slug}
            onChange={(event) => {
              setTouched(true);
              setSlug(event.target.value);
            }}
          />
        </Field>
        {error ? <ErrorNote message={error} /> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create business"}
        </Button>
      </form>
    </main>
  );
}
