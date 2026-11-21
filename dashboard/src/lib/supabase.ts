import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Publishable key. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted as the same public value. */
export function supabasePublishableKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

export function supabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && supabasePublishableKey());
}

export function getSupabase() {
  if (!supabaseConfigured()) {
    throw new Error("Supabase URL and publishable key are not set.");
  }
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, supabasePublishableKey(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
