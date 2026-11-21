"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { PublicSite, StoreConfig, StoreSection } from "@billflow/storefront";
import { ImageCropper } from "@/components/image-cropper";
import { ApiError, authed } from "@/lib/api";
import { publishImage } from "@/lib/brand-assets";
import { canAdmin } from "@/lib/access";
import { getSupabase } from "@/lib/supabase";
import type { Me } from "@/lib/types";
import { FeatureBanner } from "@/components/feature-gate";
import { Button, Card, ErrorNote, Field, Loading, inputClass } from "@/components/ui";

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  config: StoreConfig;
  preview_image_url: string | null;
}

interface DomainRow {
  id: string;
  domain: string;
  verified: boolean;
  ssl_status: string;
  txt_host: string;
  txt_value: string;
  cname_host: string;
  cname_target: string;
}

interface WebsitePayload {
  tenant: { id: string; name: string; slug: string; subdomain: string | null; logo_url: string | null };
  settings: {
    template_id: string;
    overrides: StoreConfig & { title?: string; tagline?: string; about?: string; logo_url?: string };
    published_at: string | null;
    template: TemplateRow | TemplateRow[] | null;
  } | null;
  domains: DomainRow[];
  templates: TemplateRow[];
  products?: Array<{ id: string; name: string; price: number | string; image_url?: string | null }>;
  root_domain: string;
  cname_target: string;
}

export default function WebsitePage() {
  const [payload, setPayload] = useState<WebsitePayload | null>(null);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [templateId, setTemplateId] = useState("");
  const [colors, setColors] = useState({ background: "#f8fafc", text: "#0f172a", accent: "#10b981", muted: "#64748b" });
  const [hero, setHero] = useState<"center" | "split">("center");
  const [sections, setSections] = useState<StoreSection[]>([]);
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [about, setAbout] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [heroImage, setHeroImage] = useState("");
  const [aboutImage, setAboutImage] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [domain, setDomain] = useState("");
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);

  function applyState(next: WebsitePayload) {
    setPayload(next);
    const embedded = next.settings?.template;
    const chosen = Array.isArray(embedded) ? embedded[0] : embedded;
    const draft = (next.settings?.overrides ?? chosen?.config ?? {}) as StoreConfig & {
      title?: string;
      tagline?: string;
      about?: string;
      logo_url?: string;
      hero_image_url?: string;
      about_image_url?: string;
    };
    setTemplateId(next.settings?.template_id || chosen?.id || next.templates[0]?.id || "");
    setColors({
      background: draft.colors?.background || chosen?.config.colors?.background || "#f8fafc",
      text: draft.colors?.text || chosen?.config.colors?.text || "#0f172a",
      accent: draft.colors?.accent || chosen?.config.colors?.accent || "#10b981",
      muted: draft.colors?.muted || chosen?.config.colors?.muted || "#64748b",
    });
    setHero(draft.layout?.hero === "split" ? "split" : "center");
    setSections(draft.sections || chosen?.config.sections || []);
    setTitle(draft.title || next.tenant.name);
    setTagline(draft.tagline || "");
    setAbout(draft.about || "");
    setLogoUrl(draft.logo_url || next.tenant.logo_url || "");
    setHeroImage(draft.hero_image_url || localStorage.getItem("billflow-site-hero") || "");
    setAboutImage(draft.about_image_url || localStorage.getItem("billflow-site-about") || "");
    setSubdomain(next.tenant.subdomain || next.tenant.slug);
  }

  function load() {
    setLoading(true);
    Promise.all([authed<WebsitePayload>("/website"), authed<Me>("/auth/me")])
      .then(([site, me]) => {
        applyState(site);
        setAdmin(canAdmin(me.user?.role));
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // load is recreated each render and only needs to run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewSite: PublicSite | null = useMemo(() => {
    if (!payload) return null;
    const template = payload.templates.find((item) => item.id === templateId);
    return {
      name: payload.tenant.name,
      title,
      tagline,
      about,
      logo_url: logoUrl || null,
      hero_image_url: heroImage || null,
      about_image_url: aboutImage || null,
      subdomain,
      template: { slug: template?.slug, name: template?.name },
      config: { colors, layout: { hero }, sections },
      products: payload.products ?? [],
      bestsellers: (payload.products ?? []).slice(0, 6),
    };
  }, [payload, templateId, title, tagline, about, logoUrl, heroImage, aboutImage, subdomain, colors, hero, sections]);

  useEffect(() => {
    if (!frame || !previewSite) return;
    frame.contentWindow?.postMessage({ type: "billflow-preview", site: previewSite }, window.location.origin);
  }, [frame, previewSite]);

  function overrides() {
    return {
      title,
      tagline,
      about,
      logo_url: logoUrl,
      hero_image_url: heroImage.startsWith("https://") ? heroImage : heroImage ? undefined : null,
      about_image_url: aboutImage.startsWith("https://") ? aboutImage : aboutImage ? undefined : null,
      colors,
      layout: { hero, nav: "top" },
      sections,
    };
  }

  async function saveOverrides() {
    try {
      await authed("/website/draft", { method: "PUT", body: JSON.stringify({ overrides: overrides(), template_id: templateId }) });
    } catch (reason) {
      if (!(reason instanceof ApiError) || reason.status !== 400) throw reason;
      const { hero_image_url: _hero, about_image_url: _about, ...rest } = overrides();
      void _hero;
      void _about;
      await authed("/website/draft", { method: "PUT", body: JSON.stringify({ overrides: rest, template_id: templateId }) });
    }
  }

  async function saveDraft() {
    setError(null);
    try {
      await saveOverrides();
      setNotice("Draft saved. The public site is unchanged until you publish.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save");
    }
  }

  async function publish() {
    setError(null);
    try {
      await saveOverrides();
      await authed("/website/publish", { method: "POST" });
      setNotice("Published. Visitors on your subdomain can see this version.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish");
    }
  }

  async function chooseTemplate(id: string) {
    const template = payload?.templates.find((item) => item.id === id);
    setTemplateId(id);
    if (template?.config.colors) {
      setColors({
        background: template.config.colors.background || colors.background,
        text: template.config.colors.text || colors.text,
        accent: template.config.colors.accent || colors.accent,
        muted: template.config.colors.muted || colors.muted,
      });
    }
    if (template?.config.sections) setSections(template.config.sections);
    if (template?.config.layout?.hero === "split" || template?.config.layout?.hero === "center") {
      setHero(template.config.layout.hero);
    }
    if (!admin) return;
    try {
      await authed("/website/template", { method: "POST", body: JSON.stringify({ template_id: id }) });
      setNotice(`${template?.name ?? "Template"} applied as a draft.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply the template");
    }
  }

  async function uploadLogo(file: File) {
    if (!payload) return;
    const supabase = getSupabase();
    const path = `${payload.tenant.id}/logo-${Date.now()}`;
    const { error: uploadError } = await supabase.storage.from("tenant-assets").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (uploadError) {
      setError(uploadError.message);
      return;
    }
    const { data } = supabase.storage.from("tenant-assets").getPublicUrl(path);
    setLogoUrl(data.publicUrl);
    localStorage.setItem("billflow-logo", data.publicUrl);
    setNotice("Logo uploaded. Save the draft to keep it.");
  }

  if (loading) return <Loading label="Loading your site" />;
  if (!payload) return <ErrorNote message={error ?? "Could not load the website"} onRetry={load} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Website</h1>
          <p className="text-sm text-slate-600">
            Public address {subdomain}.{payload.root_domain}
            {payload.settings?.published_at ? " · published" : " · not published"}
          </p>
        </div>
        {admin ? (
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void saveDraft()}>Save draft</Button>
            <Button type="button" onClick={() => void publish()}>Publish</Button>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Only an owner or admin can edit the site.</p>
        )}
      </div>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm">{notice}</p> : null}
      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">Templates</h2>
            <ul className="mt-3 space-y-3">
              {payload.templates.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    disabled={!admin}
                    onClick={() => void chooseTemplate(template.id)}
                    className={`w-full rounded-2xl border p-3 text-left ${templateId === template.id ? "border-navy" : "border-slate-200"}`}
                  >
                    <TemplateSlot slug={template.slug} url={template.preview_image_url} />
                    <span className="font-semibold">{template.name}</span>
                    <span className="mt-1 block text-xs text-slate-600">{template.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="font-semibold">Colors</h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(["background", "text", "accent", "muted"] as const).map((key) => (
                <label key={key} className="text-xs capitalize text-slate-600">
                  {key}
                  <input
                    type="color"
                    disabled={!admin}
                    className="mt-1 block h-10 w-full"
                    value={colors[key]}
                    onChange={(event) => setColors((current) => ({ ...current, [key]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
          </Card>
          <Card>
            <Field label="Hero layout">
              <select className={inputClass} disabled={!admin} value={hero} onChange={(event) => setHero(event.target.value as "center" | "split")}>
                <option value="center">Centered</option>
                <option value="split">Split</option>
              </select>
            </Field>
            <div className="mt-3 space-y-2">
              {sections.map((section, index) => (
                <label key={section.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!admin}
                    checked={section.enabled !== false}
                    onChange={(event) =>
                      setSections((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, enabled: event.target.checked } : item)))
                    }
                  />
                  {section.title || section.id}
                </label>
              ))}
            </div>
          </Card>
          <Card>
            <Field label="Title"><input className={inputClass} disabled={!admin} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
            <div className="mt-3">
              <Field label="Tagline"><input className={inputClass} disabled={!admin} value={tagline} onChange={(event) => setTagline(event.target.value)} /></Field>
            </div>
            <div className="mt-3">
              <Field label="About"><textarea className={inputClass} disabled={!admin} rows={3} value={about} onChange={(event) => setAbout(event.target.value)} /></Field>
            </div>
            <div className="mt-3 space-y-4">
              <ImageCropper
                label="Hero photo"
                maxEdge={1200}
                current={heroImage || null}
                onSave={(dataUrl) => {
                  void publishImage("site", dataUrl).then((result) => {
                    setHeroImage(result.url);
                    if (!result.remote) localStorage.setItem("billflow-site-hero", result.url);
                    if (result.message) setNotice(result.message);
                  }).catch((reason: Error) => setError(reason.message));
                }}
              />
              <ImageCropper
                label="About photo"
                maxEdge={1200}
                current={aboutImage || null}
                onSave={(dataUrl) => {
                  void publishImage("site", dataUrl).then((result) => {
                    setAboutImage(result.url);
                    if (!result.remote) localStorage.setItem("billflow-site-about", result.url);
                    if (result.message) setNotice(result.message);
                  }).catch((reason: Error) => setError(reason.message));
                }}
              />
            </div>
            <div className="mt-3">
            <Field label="Logo" hint="Uploaded to the tenant-assets bucket, under your tenant folder.">
                <input
                  type="file"
                  accept="image/*"
                  disabled={!admin}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadLogo(file);
                  }}
                />
              </Field>
            </div>
          </Card>
        </div>
        <Card className="min-h-[640px]">
          <h2 className="font-semibold">Preview</h2>
          <p className="mt-1 text-sm text-slate-600">Unsaved changes show here. Visitors see the last published version.</p>
          <iframe
            title="Site preview"
            src="/website/preview"
            className="mt-4 h-[560px] w-full rounded-2xl border border-slate-200 bg-white"
            ref={setFrame}
            onLoad={(event) => setFrame(event.currentTarget)}
          />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Subdomain</h2>
          <form
            className="mt-3 flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void authed("/website/subdomain", { method: "PUT", body: JSON.stringify({ subdomain }) })
                .then(() => setNotice(`Subdomain saved. Use ${subdomain}.${payload.root_domain}`))
                .catch((reason: Error) => setError(reason.message));
            }}
          >
            <input className={inputClass} disabled={!admin} value={subdomain} onChange={(event) => setSubdomain(event.target.value.toLowerCase())} />
            <Button type="submit" disabled={!admin}>Save</Button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Reserved names such as www, app, api, admin, and mail are blocked.</p>
        </Card>
        <Card>
          <h2 className="font-semibold">Custom domain</h2>
          <FeatureBanner feature="custom_domains" label="Custom domains" />
          <FeatureBanner feature="custom_templates" label="Templates other than Classic" />
          <form
            className="mt-3 flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void authed("/website/domains", { method: "POST", body: JSON.stringify({ domain }) })
                .then(() => {
                  setDomain("");
                  load();
                })
                .catch((reason: Error) => setError(reason.message));
            }}
          >
            <input className={inputClass} disabled={!admin} placeholder="pay.example.com" value={domain} onChange={(event) => setDomain(event.target.value)} />
            <Button type="submit" disabled={!admin}>Add</Button>
          </form>
          <ul className="mt-4 space-y-3 text-sm">
            {payload.domains.map((row) => (
              <li key={row.id} className="rounded-xl border border-slate-200 p-3">
                <p className="font-semibold">{row.domain} · {row.verified ? "verified" : "unverified"} · SSL {row.ssl_status}</p>
                <p className="mt-2 text-slate-600">TXT {row.txt_host} = {row.txt_value}</p>
                <p className="text-slate-600">CNAME {row.cname_host} → {row.cname_target}</p>
                {admin ? (
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void authed<{ message?: string }>(`/website/domains/${row.id}/verify`, { method: "POST" }).then((result) => {
                          setNotice(result.message || "Checked DNS");
                          load();
                        })
                      }
                    >
                      Check DNS
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => void authed(`/website/domains/${row.id}`, { method: "DELETE" }).then(load)}>
                      Remove
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

const templateArt: Record<string, { src: string; alt: string }> = {
  classic: {
    src: "/images/template-classic.webp",
    alt: "Classic public page: centered name, short tagline, quiet layout.",
  },
  modern: {
    src: "/images/template-modern.webp",
    alt: "Modern public page: split hero, stronger accent, still a real shop.",
  },
  minimal: {
    src: "/images/template-minimal.webp",
    alt: "Minimal public page: lots of space, one line of type, no decoration.",
  },
};

function TemplateSlot({ slug, url }: { slug: string; url: string | null }) {
  const art = templateArt[slug];
  if (art) {
    return (
      <Image
        src={art.src}
        alt={art.alt}
        width={1280}
        height={800}
        sizes="340px"
        className="mb-2 block h-auto w-full rounded-xl bg-[#f7f8f6] object-contain"
        style={{ aspectRatio: "8 / 5" }}
      />
    );
  }
  if (url && !url.startsWith("/templates/")) {
    return <img src={url} alt={`${slug} template preview`} width={1280} height={800} className="mb-2 block h-auto w-full rounded-xl bg-[#f7f8f6] object-contain" style={{ aspectRatio: "8 / 5" }} />;
  }
  return null;
}
