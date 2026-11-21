"use client";

import { useEffect, useState } from "react";
import { authed } from "@/lib/api";
import { FeatureBanner } from "@/components/feature-gate";
import { Button, Card, ErrorNote, Field, Loading, inputClass } from "@/components/ui";

export default function WhatsappSettingsPage() {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authed<{ phone_number_id: string | null; waba_id: string | null; enabled: boolean }>("/settings/whatsapp")
      .then((row) => {
        setPhoneNumberId(row.phone_number_id ?? "");
        setWabaId(row.waba_id ?? "");
        setEnabled(row.enabled);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;

  return (
    <Card className="mx-auto max-w-xl">
      <FeatureBanner feature="whatsapp_click_to_chat" label="WhatsApp click-to-chat" />
      <FeatureBanner feature="whatsapp_sharing" label="The WhatsApp Cloud API" />
      <h1 className="text-2xl font-bold">WhatsApp</h1>
      <p className="mt-2 text-sm text-slate-600">
        The access token is write-only. Without Meta credentials, Share on WhatsApp opens a wa.me link instead.
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void authed("/settings/whatsapp", {
            method: "PUT",
            body: JSON.stringify({
              phone_number_id: phoneNumberId,
              waba_id: wabaId,
              enabled,
              access_token: token || undefined,
            }),
          })
            .then(() => {
              setToken("");
              setNotice("Saved. The token is not shown again.");
            })
            .catch((reason: Error) => setError(reason.message));
        }}
      >
        <Field label="Phone number ID"><input className={inputClass} value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} /></Field>
        <Field label="WhatsApp Business account ID"><input className={inputClass} value={wabaId} onChange={(event) => setWabaId(event.target.value)} /></Field>
        <Field label="Access token" hint="Stored as a secret. Leave blank to keep the current token.">
          <input className={inputClass} type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Send approved template messages
        </label>
        {error ? <ErrorNote message={error} /> : null}
        {notice ? <p className="text-sm text-navy">{notice}</p> : null}
        <Button type="submit">Save WhatsApp</Button>
      </form>
    </Card>
  );
}
