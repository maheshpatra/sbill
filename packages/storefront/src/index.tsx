import type { CSSProperties } from "react";

export interface StoreSection {
  id: string;
  enabled?: boolean;
  title?: string;
  body?: string;
}

export interface StoreConfig {
  colors?: { background?: string; text?: string; accent?: string; muted?: string };
  fonts?: { heading?: string; body?: string };
  layout?: { hero?: "center" | "split" | string; nav?: string };
  sections?: StoreSection[];
}

export interface PublicSite {
  tenant_id?: string;
  slug?: string;
  subdomain?: string;
  name: string;
  title?: string | null;
  tagline?: string | null;
  about?: string | null;
  logo_url?: string | null;
  hero_image_url?: string | null;
  about_image_url?: string | null;
  products?: Array<{ id: string; name: string; price: number | string; image_url?: string | null }>;
  bestsellers?: Array<{ id: string; name: string; price: number | string; image_url?: string | null }>;
  published?: boolean;
  host?: string;
  currency?: string;
  template?: { slug?: string; name?: string };
  config?: StoreConfig;
}

const fallback: Required<NonNullable<StoreConfig["colors"]>> = {
  background: "#f8fafc",
  text: "#0f172a",
  accent: "#10b981",
  muted: "#64748b",
};

export function Storefront({ site }: { site: PublicSite }) {
  const colors = { ...fallback, ...(site.config?.colors ?? {}) };
  const fonts = site.config?.fonts ?? {};
  const hero = site.config?.layout?.hero === "split" ? "split" : "center";
  const sections = (site.config?.sections ?? []).filter((section) => section.enabled !== false);
  const style = {
    background: colors.background,
    color: colors.text,
    fontFamily: fonts.body || "Outfit, sans-serif",
    minHeight: "100%",
  } as CSSProperties;

  return (
    <div style={style}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 28px" }}>
        <strong style={{ fontFamily: fonts.heading || "inherit", fontSize: 20 }}>
          {site.logo_url ? (
            <img src={site.logo_url} alt="" style={{ height: 36, width: "auto", verticalAlign: "middle", marginRight: 8 }} />
          ) : null}
          {site.title || site.name}
        </strong>
        <span style={{ color: colors.muted, fontSize: 13 }}>{site.subdomain ? `${site.subdomain}` : site.host}</span>
      </header>
      {sections.map((section) => (
        <section
          key={section.id}
          style={{
            display: hero === "split" && section.id === "hero" ? "grid" : "block",
            gridTemplateColumns: "1.1fr 0.9fr",
            gap: 24,
            padding: section.id === "hero" ? "48px 28px" : "12px 28px 32px",
            maxWidth: 960,
            margin: "0 auto",
            textAlign: hero === "center" && section.id === "hero" ? "center" : "left",
          }}
        >
          <div>
            <p style={{ color: colors.accent, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>
              {site.template?.name || section.id}
            </p>
            <h2 style={{ fontFamily: fonts.heading || "inherit", fontSize: section.id === "hero" ? 48 : 28, lineHeight: 1.1, margin: "8px 0" }}>
              {section.title || site.tagline || site.name}
            </h2>
            <p style={{ color: colors.muted, fontSize: 18, lineHeight: 1.6 }}>{section.body || site.about || site.tagline}</p>
          </div>
          {hero === "split" && section.id === "hero" ? (
            <div style={{ border: `1px solid ${colors.accent}`, borderRadius: 24, minHeight: 180 }} />
          ) : null}
        </section>
      ))}
      {sections.length === 0 ? (
        <main style={{ padding: 48, textAlign: "center" }}>
          <h1 style={{ fontFamily: fonts.heading || "inherit" }}>{site.title || site.name}</h1>
          <p>{site.tagline || site.about}</p>
        </main>
      ) : null}
    </div>
  );
}
