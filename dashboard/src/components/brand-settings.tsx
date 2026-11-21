"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ImageCropper } from "@/components/image-cropper";
import { TemplatePicker } from "@/components/template-picker";
import { Card } from "@/components/ui";
import { publishImage, readAvatar, readLogo } from "@/lib/brand-assets";
import { authed } from "@/lib/api";
import { isTemplateKey, persistDefaultTemplate, type TemplateKey } from "@/lib/templates";
import type { Tenant } from "@/lib/types";

export function BrandSettings() {
  const [logo, setLogo] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [template, setTemplate] = useState<TemplateKey>("classic");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setLogo(readLogo());
    setAvatar(readAvatar());
    void authed<Tenant>("/tenants/current")
      .then((tenant) => {
        if (isTemplateKey(tenant.default_template)) setTemplate(tenant.default_template);
        if (tenant.logo_url) setLogo(tenant.logo_url);
      })
      .catch(() => undefined);
  }, []);

  return (
    <Card className="space-y-6">
      <div>
        <h2 className="font-semibold">Bill template</h2>
        <p className="mt-1 text-sm text-slate-600">
          This is the default for new bills. A bill can still pick another.{" "}
          <Link className="font-semibold underline" href="/invoices/templates">Open the gallery</Link>
        </p>
        <div className="mt-3">
          <TemplatePicker
            value={template}
            onChange={(key) => {
              setTemplate(key);
              void persistDefaultTemplate(key).catch((reason: Error) => setNotice(reason.message));
            }}
          />
        </div>
      </div>
      <ImageCropper
        label="Business logo"
        maxEdge={512}
        current={logo}
        onSave={(dataUrl) => {
          setLogo(dataUrl);
          void publishImage("logo", dataUrl).then((result) => {
            setLogo(result.url);
            if (result.message) setNotice(result.message);
          }).catch((reason: Error) => setNotice(reason.message));
        }}
      />
      <ImageCropper
        label="Your photo"
        maxEdge={256}
        current={avatar}
        onSave={(dataUrl) => {
          setAvatar(dataUrl);
          void publishImage("avatar", dataUrl).then((result) => {
            setAvatar(result.url);
            if (result.message) setNotice(result.message);
          }).catch((reason: Error) => setNotice(reason.message));
        }}
      />
      {notice ? <p className="text-sm text-slate-600">{notice}</p> : null}
    </Card>
  );
}
