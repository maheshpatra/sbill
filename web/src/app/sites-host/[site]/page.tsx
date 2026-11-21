import { notFound } from "next/navigation";
import { Storefront } from "@billflow/storefront";
import { loadPublishedSite } from "@/lib/load-site";

export const revalidate = 60;

export default async function TenantSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ site: string }>;
  searchParams: Promise<{ resolvedHost?: string }>;
}) {
  const [{ site }, query] = await Promise.all([params, searchParams]);
  const host = query.resolvedHost || decodeURIComponent(site);
  const published = await loadPublishedSite(host);
  if (!published) notFound();
  return <Storefront site={published} />;
}
