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

export interface ShopProduct {
  id: string;
  name: string;
  price: number | string;
  image_url?: string | null;
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
  published?: boolean;
  host?: string;
  currency?: string;
  locale?: string | null;
  template?: { slug?: string; name?: string };
  config?: StoreConfig;
  bestsellers?: ShopProduct[];
  products?: ShopProduct[];
}

const fallback: Required<NonNullable<StoreConfig["colors"]>> = {
  background: "#f8fafc",
  text: "#0f172a",
  accent: "#10b981",
  muted: "#64748b",
};

function templateKind(site: PublicSite) {
  const slug = `${site.template?.slug || ""} ${site.template?.name || ""}`.toLowerCase();
  if (slug.includes("minimal")) return "minimal";
  if (slug.includes("modern") || site.config?.layout?.hero === "split") return "modern";
  return "classic";
}

function rupee(value: number | string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function labels(locale?: string | null) {
  if (locale === "bn") return { upi: "ইউপিআই", cash: "নগদ", delivery: "বাড়ি ডেলিভারি", whatsapp: "হোয়াটসঅ্যাপ অর্ডার" };
  return { upi: "UPI accepted", cash: "Cash", delivery: "Home delivery", whatsapp: "WhatsApp order" };
}

function productsOf(site: PublicSite) {
  const rows = site.products?.length ? site.products : site.bestsellers ?? [];
  return rows.slice(0, 6);
}

export function Storefront({ site }: { site: PublicSite }) {
  const colors = { ...fallback, ...(site.config?.colors ?? {}) };
  const fonts = site.config?.fonts ?? {};
  const kind = templateKind(site);
  const sections = (site.config?.sections ?? []).filter((section) => section.enabled !== false);
  const goods = productsOf(site);
  const copy = labels(site.locale);
  const aboutSection = sections.find((section) => section.id === "about");
  const heroTitle = sections.find((section) => section.id === "hero")?.title || site.tagline || site.name;
  const heroBody = sections.find((section) => section.id === "hero")?.body || site.tagline || "";

  return (
    <div className="sf" style={{ background: colors.background, color: colors.text, fontFamily: fonts.body || "Outfit, sans-serif", minHeight: "100%" }}>
      <style>{`
        .sf-hero-modern { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 24px; align-items: center; }
        .sf-about { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 24px; align-items: center; }
        .sf-goods { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
        .sf-thumbs { display: flex; gap: 16px; overflow-x: auto; }
        @media (max-width: 640px) {
          .sf-hero-modern, .sf-about, .sf-goods { grid-template-columns: 1fr; }
          .sf-pad { padding-left: 16px !important; padding-right: 16px !important; }
        }
      `}</style>
      <header className="sf-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 28px", gap: 12 }}>
        <strong style={{ fontFamily: fonts.heading || "inherit", fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
          {site.logo_url ? <img src={site.logo_url} alt="" style={{ height: 36, width: 36, objectFit: "cover", borderRadius: 8 }} /> : <LogoMark name={site.name} accent={colors.accent} />}
          {site.title || site.name}
        </strong>
        <span style={{ color: colors.muted, fontSize: 13 }}>{site.subdomain || site.host}</span>
      </header>
      {kind === "classic" ? <ClassicHero site={site} colors={colors} fonts={fonts} title={heroTitle} body={heroBody} /> : null}
      {kind === "modern" ? <ModernHero site={site} colors={colors} fonts={fonts} title={heroTitle} body={heroBody} /> : null}
      {kind === "minimal" ? (
        <main className="sf-pad" style={{ padding: "32px 28px 8px", textAlign: "center" }}>
          {site.logo_url ? <img src={site.logo_url} alt="" style={{ height: 72, width: 72, objectFit: "cover", borderRadius: 16 }} /> : <LogoMark name={site.name} accent={colors.accent} large />}
          <h1 style={{ fontFamily: fonts.heading || "inherit", fontSize: 40, margin: "16px 0 8px" }}>{site.title || site.name}</h1>
          <p style={{ color: colors.muted }}>{site.tagline}</p>
        </main>
      ) : null}
      {goods.length ? <BestsellerRow goods={goods} colors={colors} fonts={fonts} round={kind === "modern"} /> : null}
      {kind !== "minimal" && (aboutSection || site.about) ? (
        <AboutBlock site={site} colors={colors} fonts={fonts} title={aboutSection?.title || "About"} body={aboutSection?.body || site.about || ""} />
      ) : null}
      <IconStrip copy={copy} colors={colors} />
    </div>
  );
}

function ClassicHero({
  site,
  colors,
  fonts,
  title,
  body,
}: {
  site: PublicSite;
  colors: typeof fallback;
  fonts: NonNullable<StoreConfig["fonts"]>;
  title: string;
  body: string;
}) {
  const photo = site.hero_image_url;
  return (
    <section className="sf-pad" style={{ position: "relative", minHeight: 280, display: "grid", placeItems: "center", textAlign: "center", color: photo ? "#fff" : colors.text, overflow: "hidden", padding: "64px 28px" }}>
      {photo ? (
        <img src={photo} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg, ${colors.accent}, ${colors.background})` }} />
      )}
      {photo ? <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,0.45)" }} /> : null}
      <div style={{ position: "relative", maxWidth: 640 }}>
        <h1 style={{ fontFamily: fonts.heading || "inherit", fontSize: 48, lineHeight: 1.1, margin: 0 }}>{title}</h1>
        <p style={{ fontSize: 18, lineHeight: 1.6 }}>{body}</p>
      </div>
    </section>
  );
}

function ModernHero({
  site,
  colors,
  fonts,
  title,
  body,
}: {
  site: PublicSite;
  colors: typeof fallback;
  fonts: NonNullable<StoreConfig["fonts"]>;
  title: string;
  body: string;
}) {
  return (
    <section className="sf-hero-modern sf-pad" style={{ maxWidth: 960, margin: "0 auto", padding: "32px 28px" }}>
      <div>
        <p style={{ color: colors.accent, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>{site.template?.name || "Modern"}</p>
        <h1 style={{ fontFamily: fonts.heading || "inherit", fontSize: 48, lineHeight: 1.1, margin: "8px 0" }}>{title}</h1>
        <p style={{ color: colors.muted, fontSize: 18, lineHeight: 1.6 }}>{body}</p>
      </div>
      <div style={{ minHeight: 220, borderRadius: 24, overflow: "hidden", background: tint(colors.accent) }}>
        {site.hero_image_url ? (
          <img src={site.hero_image_url} alt="" style={{ width: "100%", height: "100%", minHeight: 220, objectFit: "cover", borderRadius: 24 }} />
        ) : (
          <div style={{ minHeight: 220, display: "grid", placeItems: "center" }}>
            {site.logo_url ? <img src={site.logo_url} alt="" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 20 }} /> : <LogoMark name={site.name} accent={colors.accent} large />}
          </div>
        )}
      </div>
    </section>
  );
}

function AboutBlock({
  site,
  colors,
  fonts,
  title,
  body,
}: {
  site: PublicSite;
  colors: typeof fallback;
  fonts: NonNullable<StoreConfig["fonts"]>;
  title: string;
  body: string;
}) {
  return (
    <section className="sf-about sf-pad" style={{ maxWidth: 960, margin: "0 auto", padding: "12px 28px 32px" }}>
      <div>
        <h2 style={{ fontFamily: fonts.heading || "inherit", fontSize: 28, margin: "8px 0" }}>{title}</h2>
        <p style={{ color: colors.muted, fontSize: 18, lineHeight: 1.6 }}>{body}</p>
      </div>
      <div style={{ minHeight: 180, borderRadius: 24, overflow: "hidden", background: tint(colors.accent), display: "grid", placeItems: "center" }}>
        {site.about_image_url ? (
          <img src={site.about_image_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", minHeight: 180, objectFit: "cover" }} />
        ) : site.logo_url ? (
          <img src={site.logo_url} alt="" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 24 }} />
        ) : (
          <LogoMark name={site.name} accent={colors.accent} large />
        )}
      </div>
    </section>
  );
}

function BestsellerRow({ goods, colors, fonts, round }: { goods: ShopProduct[]; colors: typeof fallback; fonts: NonNullable<StoreConfig["fonts"]>; round: boolean }) {
  return (
    <section className="sf-pad" style={{ maxWidth: 960, margin: "0 auto", padding: "8px 28px 28px" }}>
      <div className={round ? "sf-thumbs" : "sf-goods"}>
        {goods.map((item) => (
          <article key={item.id} style={{ minWidth: round ? 120 : undefined, textAlign: "center" }}>
            <ProductPhoto name={item.name} url={item.image_url} round={round} />
            <p style={{ fontFamily: fonts.heading || "inherit", margin: "8px 0 0", fontSize: 14 }}>{item.name}</p>
            <p style={{ color: colors.muted, margin: 0, fontSize: 13 }}>{rupee(item.price)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProductPhoto({ name, url, round }: { name: string; url?: string | null; round?: boolean }) {
  const radius = round ? 999 : 16;
  const size = round ? 96 : "100%";
  if (url) {
    return <img src={url} alt="" loading="lazy" style={{ width: size, height: round ? 96 : undefined, aspectRatio: round ? "1 / 1" : "4 / 5", objectFit: "cover", borderRadius: radius, margin: "0 auto" }} />;
  }
  return (
    <div style={{ width: size, aspectRatio: round ? "1 / 1" : "4 / 5", borderRadius: radius, background: "#e2e8f0", color: "#0f172a", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 28, margin: "0 auto" }}>
      {(name.trim()[0] || "?").toUpperCase()}
    </div>
  );
}

function IconStrip({ copy, colors }: { copy: ReturnType<typeof labels>; colors: typeof fallback }) {
  const items = [
    ["upi", copy.upi],
    ["cash", copy.cash],
    ["delivery", copy.delivery],
    ["whatsapp", copy.whatsapp],
  ] as const;
  return (
    <footer className="sf-pad" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 16, padding: "20px 28px 32px", borderTop: `1px solid ${colors.muted}33`, color: colors.muted, fontSize: 13 }}>
      {items.map(([id, label]) => (
        <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32 }}>
          <Icon id={id} />
          {label}
        </span>
      ))}
    </footer>
  );
}

function Icon({ id }: { id: "upi" | "cash" | "delivery" | "whatsapp" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true };
  if (id === "cash") {
    return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></svg>;
  }
  if (id === "delivery") {
    return <svg {...common}><path d="M3 11l9-7 9 7" /><path d="M5 10v9h14v-9" /></svg>;
  }
  if (id === "whatsapp") {
    return <svg {...common}><path d="M6 18l-1 3 3-1a8 8 0 1 0-2-2z" /></svg>;
  }
  return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 12h8M12 8v8" /></svg>;
}

function LogoMark({ name, accent, large }: { name: string; accent: string; large?: boolean }) {
  return (
    <span style={{ width: large ? 96 : 36, height: large ? 96 : 36, borderRadius: large ? 24 : 8, background: accent, color: "#0f172a", display: "inline-grid", placeItems: "center", fontWeight: 700, fontSize: large ? 36 : 16 }}>
      {(name.trim()[0] || "b").toUpperCase()}
    </span>
  );
}

function tint(accent: string) {
  return `${accent}22`;
}
