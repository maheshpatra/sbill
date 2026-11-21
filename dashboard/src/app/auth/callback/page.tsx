"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNote, Loading } from "@/components/ui";
import { getSupabase, supabaseConfigured } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured()) {
      setError("Supabase is not configured.");
      return;
    }
    const supabase = getSupabase();
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const finish = () => router.replace("/");
    if (code) {
      void supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
        if (exchangeError) setError(exchangeError.message);
        else finish();
      });
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish();
      else setError("This sign-in link is missing a session. Request a new one.");
    });
  }, [router]);

  return <main className="p-8">{error ? <ErrorNote message={error} /> : <Loading label="Signing you in" />}</main>;
}
