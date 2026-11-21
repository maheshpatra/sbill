import type { PublicSite } from "@billflow/storefront";

export async function loadPublishedSite(host: string): Promise<PublicSite | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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
