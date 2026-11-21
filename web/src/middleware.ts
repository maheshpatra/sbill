import { NextResponse, type NextRequest } from "next/server";
import { normalizeHost, resolveRequestHost } from "@billflow/host-resolution";

export function middleware(request: NextRequest) {
  const headerHost = request.headers.get("host");
  const queryHost = request.nextUrl.searchParams.get("host");
  const bare = normalizeHost(headerHost);
  // This process is the marketing/site app. Bare localhost stays the marketing page.
  // Tenant sites are opened as {slug}.localhost or ?host= on localhost.
  if ((bare === "localhost" || bare === "127.0.0.1") && !queryHost) {
    return NextResponse.next();
  }
  const root = process.env.ROOT_DOMAIN || process.env.NEXT_PUBLIC_ROOT_DOMAIN || "billflow.com";
  const resolution = resolveRequestHost(headerHost, queryHost, {
    appDomain: root,
    dashboardHost: process.env.DASHBOARD_HOST || `app.${root}`,
  });

  if (resolution.kind === "marketing") {
    return NextResponse.next();
  }

  if (resolution.kind === "dashboard") {
    const dashboard = process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://127.0.0.1:4319";
    return NextResponse.redirect(dashboard);
  }

  const url = request.nextUrl.clone();
  const key = resolution.kind === "tenant-subdomain" ? resolution.slug : resolution.host;
  url.pathname = `/sites-host/${encodeURIComponent(key)}`;
  url.searchParams.set("resolvedHost", resolution.host);
  const response = NextResponse.rewrite(url);
  response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|sites-host|brand|templates|images|favicon.ico|site.webmanifest|robots.txt|sitemap.xml).*)"],
};
