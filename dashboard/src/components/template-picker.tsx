"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { authed } from "@/lib/api";
import { featureOn, useEntitlements } from "@/lib/entitlements";
import { TEMPLATES, isTemplateKey, type TemplateKey } from "@/lib/templates";

interface RemoteTemplate {
  key: string;
  name: string;
  description?: string | null;
  required_feature?: string | null;
  required_plan?: string | null;
  entitled?: boolean;
}

export function TemplatePicker({
  value,
  onChange,
}: {
  value: TemplateKey;
  onChange: (key: TemplateKey) => void;
}) {
  const { entitlements, showUpgrade } = useEntitlements();
  const [remote, setRemote] = useState<RemoteTemplate[] | null>(null);

  useEffect(() => {
    void authed<{ data: RemoteTemplate[] }>("/invoice-templates")
      .then((page) => setRemote(page.data ?? []))
      .catch(() => setRemote(null));
  }, []);

  const items = (remote ?? TEMPLATES.map((item) => ({
    key: item.key,
    name: item.name,
    description: item.detail,
    required_feature: item.feature || null,
    entitled: !item.feature || !entitlements || featureOn(entitlements, item.feature),
  }))).filter((item) => isTemplateKey(item.key));

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => {
        const key = item.key as TemplateKey;
        const locked = item.entitled === false;
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={selected}
            className={`min-h-12 rounded-2xl border px-3 py-2 text-left text-sm pop-press ${selected ? "border-navy bg-navy text-white" : "border-slate-200 bg-white"}`}
            onClick={() => {
              if (locked) {
                showUpgrade(item.required_feature || "custom_templates");
                return;
              }
              onChange(key);
            }}
          >
            <span className="flex items-center gap-2 font-semibold">
              {item.name}
              {locked ? <Lock size={14} aria-label="Locked" /> : null}
            </span>
            <span className={`mt-1 block ${selected ? "text-slate-200" : "text-slate-500"}`}>{item.description}{"required_plan" in item && item.required_plan ? ` · ${item.required_plan}` : ""}</span>
          </button>
        );
      })}
    </div>
  );
}
