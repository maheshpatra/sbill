"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { ApiError, authed } from "@/lib/api";

type StorageId = "supabase" | "cloudinary" | "r2";

interface ProviderDetails {
  cloud_name?: string | null;
  api_key?: string | null;
  secret_set?: boolean;
  source?: string | null;
  public_url?: string;
  buckets?: string[];
  folders?: string[] | Record<string, string>;
}

interface ProviderState {
  configured?: boolean;
  available?: boolean;
  details?: ProviderDetails;
}

interface AdminSettings {
  app_domain?: string;
  dashboard_host?: string;
  storage_provider?: string;
  storage?: {
    provider?: string;
    providers?: Partial<Record<StorageId, ProviderState>>;
  };
}

const SUPABASE_BUCKETS = ["logos", "avatars", "bill-photos", "products", "site-images"];
const CLOUDINARY_FOLDERS = ["logos: billflow/logos", "avatars: billflow/avatars", "products: billflow/products", "site: billflow/site"];

function folderLines(folders?: string[] | Record<string, string>) {
  if (Array.isArray(folders) && folders.length) return folders;
  if (folders && !Array.isArray(folders)) return Object.entries(folders).map(([key, value]) => `${key}: ${value}`);
  return CLOUDINARY_FOLDERS;
}

function providerState(settings: AdminSettings | null, id: StorageId): ProviderState {
  return settings?.storage?.providers?.[id] ?? {};
}

function isConfigured(state: ProviderState) {
  return state.configured === true;
}

export default function AdminSitePage() {
  const [domain, setDomain] = useState("");
  const [host, setHost] = useState("");
  const [provider, setProvider] = useState<StorageId>("supabase");
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [cloudName, setCloudName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [secretOpen, setSecretOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  function applySettings(row: AdminSettings) {
    setSettings(row);
    setDomain(row.app_domain ?? "");
    setHost(row.dashboard_host ?? "");
    const details = row.storage?.providers?.cloudinary?.details;
    setCloudName(details?.cloud_name ?? "");
    setApiKey(details?.api_key ?? "");
    setSecretOpen(false);
    const current = row.storage?.provider || row.storage_provider;
    const cloudinaryReady = row.storage?.providers?.cloudinary?.configured === true;
    if (current === "cloudinary" && cloudinaryReady) setProvider("cloudinary");
    else if (current === "supabase" || current === "cloudinary") setProvider("supabase");
  }

  useEffect(() => {
    void authed<AdminSettings>("/admin/settings")
      .then(applySettings)
      .catch((reason: Error) => {
        const preview = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("preview") === "local";
        if (!preview) setError(reason.message);
      });
  }, []);

  const supabase = providerState(settings, "supabase");
  const cloudinary = providerState(settings, "cloudinary");
  const buckets = supabase.details?.buckets?.length ? supabase.details.buckets : SUPABASE_BUCKETS;
  const folders = folderLines(cloudinary.details?.folders);
  const secretSet = cloudinary.details?.secret_set === true;
  const cloudinarySelectable = isConfigured(cloudinary);

  function readAndClearSecret() {
    const typed = secretRef.current?.value ?? "";
    if (secretRef.current) secretRef.current.value = "";
    setSecretOpen(false);
    return typed;
  }

  return (
    <form
      className="max-w-5xl space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setNotice(null);
        const typedSecret = readAndClearSecret();
        const cloudinaryBody: { cloud_name?: string; api_key?: string; api_secret?: string } = {};
        if (cloudName.trim()) cloudinaryBody.cloud_name = cloudName.trim();
        if (apiKey.trim()) cloudinaryBody.api_key = apiKey.trim();
        if (typedSecret) cloudinaryBody.api_secret = typedSecret;
        const body: Record<string, unknown> = {
          app_domain: domain,
          dashboard_host: host,
          storage_provider: provider,
        };
        if (Object.keys(cloudinaryBody).length) body.cloudinary = cloudinaryBody;
        void authed("/admin/settings", { method: "PATCH", body: JSON.stringify(body) })
          .then((row) => {
            applySettings(row as AdminSettings);
            setNotice("Site settings saved.");
          })
          .catch(async (reason: unknown) => {
            if (reason instanceof ApiError && reason.code === "STORAGE_PROVIDER_NOT_CONFIGURED") {
              setProvider("supabase");
              setError("Save the Cloudinary details first, then choose it.");
              return;
            }
            if (reason instanceof ApiError && reason.status === 400 && body.cloudinary) {
              const { cloudinary: _omitted, ...rest } = body;
              void _omitted;
              try {
                await authed("/admin/settings", { method: "PATCH", body: JSON.stringify(rest) });
                setNotice("Domain and host are saved. Cloudinary details will save when the backend accepts them.");
                return;
              } catch (inner) {
                setError(inner instanceof Error ? inner.message : "Could not save site settings");
                return;
              }
            }
            setError(reason instanceof Error ? reason.message : "Could not save site settings");
          });
      }}
    >
      <h1 className="text-2xl font-bold">Site settings</h1>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="text-sm">{notice}</p> : null}
      <div className="grid max-w-lg gap-4">
        <Field label="App domain">
          <input className={inputClass} value={domain} onChange={(event) => setDomain(event.target.value)} />
        </Field>
        <Field label="Dashboard host">
          <input className={inputClass} value={host} onChange={(event) => setHost(event.target.value)} />
        </Field>
      </div>
      <section className="space-y-3" aria-labelledby="storage-heading">
        <h2 id="storage-heading" className="text-lg font-semibold">Storage for logos & photos</h2>
        <div className="grid gap-3 lg:grid-cols-3" role="radiogroup" aria-label="Storage provider">
          <ProviderCard
            name="Supabase Storage"
            selected={provider === "supabase"}
            configured={isConfigured(supabase)}
            onSelect={() => setProvider("supabase")}
          >
            <p>Buckets: {buckets.join(", ")}</p>
            <p className="break-all">Public URL: {supabase.details?.public_url || "https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>"}</p>
          </ProviderCard>
          <ProviderCard
            name="Cloudinary"
            value="cloudinary"
            selected={provider === "cloudinary"}
            configured={isConfigured(cloudinary)}
            radioDisabled={!cloudinarySelectable}
            onSelect={() => {
              if (!cloudinarySelectable) {
                setError("Save the Cloudinary details first, then choose it.");
                return;
              }
              setProvider("cloudinary");
            }}
          >
            <Field label="Cloud name">
              <input className={inputClass} name="cloud_name" autoComplete="off" value={cloudName} onChange={(event) => setCloudName(event.target.value)} />
            </Field>
            <Field label="API key">
              <input className={inputClass} name="api_key" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
            </Field>
            <p className="text-sm">{secretSet ? "Secret saved" : "Not set"}</p>
            {secretOpen ? (
              <Field label="API secret">
                <input ref={secretRef} className={inputClass} name="api_secret" type="password" autoComplete="new-password" defaultValue="" />
              </Field>
            ) : (
              <button type="button" className="min-h-12 rounded-full border border-slate-300 px-4 text-sm font-semibold" onClick={() => setSecretOpen(true)}>
                {secretSet ? "Replace" : "Set secret"}
              </button>
            )}
            <p>Folders: {folders.join(", ")}</p>
            {!cloudinarySelectable ? <p>Save the Cloudinary details first, then choose it.</p> : null}
          </ProviderCard>
          <ProviderCard name="Cloudflare R2" selected={false} configured={false} disabled unavailable />
        </div>
      </section>
      <Button type="submit">Save</Button>
    </form>
  );
}

function ProviderCard({
  name,
  value,
  selected,
  configured,
  disabled,
  radioDisabled,
  unavailable,
  onSelect,
  children,
}: {
  name: string;
  value?: string;
  selected: boolean;
  configured: boolean;
  disabled?: boolean;
  radioDisabled?: boolean;
  unavailable?: boolean;
  onSelect?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border bg-white p-4 text-sm ${disabled ? "cursor-not-allowed opacity-60" : ""} ${selected ? "border-navy" : "border-slate-200"}`}>
      <span className="flex items-start justify-between gap-3">
        <span className="font-semibold">{name}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${unavailable ? "bg-slate-100 text-slate-500" : configured ? "bg-emerald/20 text-navy" : "bg-amber-100 text-amber-950"}`}>
          {unavailable ? "Not available" : configured ? "Configured" : "Not configured"}
        </span>
      </span>
      <input
        className="mt-3 h-5 w-5 disabled:opacity-40"
        type="radio"
        name="storage_provider"
        value={value ?? name}
        checked={selected}
        disabled={disabled || radioDisabled}
        onChange={() => onSelect?.()}
      />
      <div className="mt-3 space-y-3 text-slate-600">{unavailable ? <p>R2 is not available.</p> : children}</div>
    </div>
  );
}
