import { createBillflowClient } from "@billflow/api-client";
import type { PublicSite } from "@billflow/storefront";

function publishableKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
}

async function fromApi(host: string): Promise<PublicSite | null> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://127.0.0.1:4317";
  const client = createBillflowClient({ baseUrl });
  const result = await client.GET("/sites/resolve", {
    params: { query: { host } },
    parseAs: "json",
  });
  if (!result.response.ok) return null;
  const body = (result.data ?? (await result.response.json().catch(() => null))) as { site?: PublicSite | null } | null;
  return body?.site ?? null;
}

async function fromSupabase(host: string): Promise<PublicSite | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = publishableKey();
  if (!supabaseUrl || !anonKey) return null;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/get_site_by_host`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_host: host }),
    next: { revalidate: 60 },
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as PublicSite | null;
  return payload;
}

/** Public tenant site. The API route is the contract. The RPC is the fallback when the API is down. */
export async function loadPublishedSite(host: string): Promise<PublicSite | null> {
  try {
    const site = await fromApi(host);
    if (site) return site;
  } catch {
    // API unreachable. Try the public RPC next.
  }
  try {
    return await fromSupabase(host);
  } catch {
    return null;
  }
}
