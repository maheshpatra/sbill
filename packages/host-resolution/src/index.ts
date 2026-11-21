export interface HostResolutionOptions {
  /** Apex domain, no protocol and no port. Default `billflow.com`. */
  appDomain?: string;
  /** Host that serves the signed-in tenant app. Default `app.{appDomain}`. */
  dashboardHost?: string;
  /** Hosts that serve the marketing site. Default apex and `www`. */
  marketingHosts?: string[];
}

export type HostResolution =
  | { kind: 'marketing'; host: string }
  | { kind: 'dashboard'; host: string }
  | { kind: 'tenant-subdomain'; host: string; slug: string }
  | { kind: 'custom-domain'; host: string };

export const RESERVED_SUBDOMAINS = [
  'www',
  'app',
  'api',
  'billing',
  'admin',
  'static',
  'dashboard',
  'auth',
  'mail',
  'sites',
  'status',
  'cdn',
  'ftp',
  'smtp',
  'imap',
  'pop',
  'ns1',
  'ns2',
  'support',
  'help',
  'blog',
  'root',
] as const;

const RESERVED_LABELS = new Set<string>(RESERVED_SUBDOMAINS);

/** Lower-case host without port or a trailing dot. */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return '';
  const trimmed = host.trim().toLowerCase();
  const withoutProto = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const hostOnly = withoutProto.split('/')[0] ?? '';
  return hostOnly.split(':')[0]?.replace(/\.$/, '') ?? '';
}

/**
 * Classify a request host for the marketing site, the tenant dashboard,
 * a tenant subdomain, or a custom domain that must be resolved with
 * `get_site_by_host`.
 *
 * Local convention mirrors production: `localhost` is the dashboard,
 * `www.localhost` is marketing, and `{slug}.localhost` is a tenant site.
 */
export function resolveHost(input: string, options: HostResolutionOptions = {}): HostResolution {
  const appDomain = (options.appDomain ?? 'billflow.com').toLowerCase();
  const dashboardHost = (options.dashboardHost ?? `app.${appDomain}`).toLowerCase();
  const marketingHosts = new Set(
    (options.marketingHosts ?? [appDomain, `www.${appDomain}`]).map((host) => host.toLowerCase()),
  );
  const host = normalizeHost(input);

  if (!host || marketingHosts.has(host)) {
    return { kind: 'marketing', host };
  }
  if (host === dashboardHost || host === 'localhost' || host === '127.0.0.1') {
    return { kind: 'dashboard', host };
  }

  if (host.endsWith(`.${appDomain}`)) {
    const slug = host.slice(0, -(appDomain.length + 1));
    if (slug && !slug.includes('.') && !RESERVED_LABELS.has(slug)) {
      return { kind: 'tenant-subdomain', host, slug };
    }
    return { kind: 'marketing', host };
  }

  if (host.endsWith('.localhost')) {
    const slug = host.slice(0, -'.localhost'.length);
    if (!slug || slug === 'www') return { kind: 'marketing', host };
    if (!slug.includes('.') && !RESERVED_LABELS.has(slug)) {
      return { kind: 'tenant-subdomain', host, slug };
    }
  }

  return { kind: 'custom-domain', host };
}

export function createHostResolver(options: HostResolutionOptions = {}) {
  return (host: string) => resolveHost(host, options);
}

/**
 * Host the middleware should classify. On localhost, `?host=` overrides the
 * header so a tenant site can be opened without wildcard DNS. The override is
 * ignored on any other host.
 */
export function resolveRequestHost(
  headerHost: string | null | undefined,
  queryHost: string | null | undefined,
  options: HostResolutionOptions = {},
): HostResolution {
  const header = normalizeHost(headerHost);
  const local = header === 'localhost' || header === '127.0.0.1' || header.endsWith('.localhost');
  const chosen = local && queryHost ? queryHost : headerHost;
  return resolveHost(chosen ?? '', options);
}
