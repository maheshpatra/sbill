"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isValidGstin, normalizeGstin } from "@billflow/gst";
import { BrandSettings } from "@/components/brand-settings";
import { LockedFeature } from "@/components/feature-gate";
import { Button, Card, CardSkeleton, ErrorNote, Field, Loading, inputClass } from "@/components/ui";
import { authed } from "@/lib/api";
import { canAdmin } from "@/lib/access";
import { GST_STATES } from "@/lib/states";
import type { Me, Member, Role, Tenant } from "@/lib/types";

const GSTIN_ERROR = "Enter a valid 15-character GSTIN, for example 22AAAAA0000A1ZC, or leave the field blank.";

function gstinHint(value: string | null) {
  const normalized = normalizeGstin(value);
  if (!normalized) return "Optional. Leave blank if this business has no GSTIN.";
  if (isValidGstin(normalized)) return "Valid GSTIN.";
  return "Not a valid 15-character GSTIN.";
}

export default function SettingsPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<Role, "owner">>("member");

  function load() {
    setLoading(true);
    Promise.all([
      authed<Tenant>("/tenants/current"),
      authed<{ data: Member[] }>("/tenants/members"),
      authed<Me>("/auth/me"),
    ])
      .then(([nextTenant, memberPage, profile]) => {
        setTenant(nextTenant);
        setMembers(memberPage.data);
        setMe(profile);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!tenant) return;
    setError(null);
    setNotice(null);
    const gstin = normalizeGstin(tenant.gstin);
    if (gstin && !isValidGstin(gstin)) {
      setError(GSTIN_ERROR);
      return;
    }
    try {
      if (gstin) {
        await authed("/gstin/validate", { method: "POST", body: JSON.stringify({ gstin }) });
      }
      const updated = await authed<Tenant>("/tenants/current", {
        method: "PATCH",
        body: JSON.stringify({
          name: tenant.name,
          legal_name: tenant.legal_name,
          gstin,
          email: tenant.email,
          phone: tenant.phone,
          address_line1: tenant.address_line1,
          city: tenant.city,
          state: tenant.state,
          state_code: tenant.state_code,
          pincode: tenant.pincode,
          upi_vpa: tenant.upi_vpa,
        }),
      });
      setTenant(updated);
      setNotice("Business profile saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save");
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await authed("/tenants/members", {
        method: "POST",
        body: JSON.stringify({ email, role: inviteRole }),
      });
      setEmail("");
      setNotice("Invitation sent.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not invite");
    }
  }

  async function changeRole(id: string, role: Role) {
    setError(null);
    try {
      await authed(`/tenants/members/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change role");
    }
  }

  if (loading) return <CardSkeleton />;
  if (!tenant || !me) return <ErrorNote message={error ?? "Could not load settings"} onRetry={load} />;

  const admin = canAdmin(me.user?.role);
  function setField<K extends keyof Tenant>(key: K, value: Tenant[K]) {
    setTenant((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <BrandSettings />
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm">{notice}</p> : null}
      <Card>
        <h2 className="font-semibold">Business profile</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
          <Field label="Name"><input className={inputClass} disabled={!admin} value={tenant.name} onChange={(event) => setField("name", event.target.value)} /></Field>
          <Field label="Legal name"><input className={inputClass} disabled={!admin} value={tenant.legal_name ?? ""} onChange={(event) => setField("legal_name", event.target.value)} /></Field>
          <Field label="GSTIN" hint={gstinHint(tenant.gstin)}>
            <input
              className={inputClass}
              disabled={!admin}
              maxLength={15}
              value={tenant.gstin ?? ""}
              onChange={(event) => setField("gstin", event.target.value.replace(/\s/g, "").toUpperCase())}
            />
          </Field>
          <p className="text-sm text-slate-600 sm:col-span-2"><Link className="font-semibold text-navy underline" href="/settings/payments">UPI payment settings</Link> hold the VPA and the name shown in the payer&apos;s app.</p>
          <Field label="Email"><input className={inputClass} disabled={!admin} value={tenant.email ?? ""} onChange={(event) => setField("email", event.target.value)} /></Field>
          <Field label="Phone"><input className={inputClass} disabled={!admin} value={tenant.phone ?? ""} onChange={(event) => setField("phone", event.target.value)} /></Field>
          <Field label="Address"><input className={inputClass} disabled={!admin} value={tenant.address_line1 ?? ""} onChange={(event) => setField("address_line1", event.target.value)} /></Field>
          <Field label="City"><input className={inputClass} disabled={!admin} value={tenant.city ?? ""} onChange={(event) => setField("city", event.target.value)} /></Field>
          <Field label="State"><input className={inputClass} disabled={!admin} value={tenant.state ?? ""} onChange={(event) => setField("state", event.target.value)} /></Field>
          <Field label="State code">
            <select className={inputClass} disabled={!admin} value={tenant.state_code ?? ""} onChange={(event) => setField("state_code", event.target.value)}>
              <option value="">Select</option>
              {GST_STATES.map((state) => (
                <option key={state.code} value={state.code}>{state.code} · {state.name}</option>
              ))}
            </select>
          </Field>
          <Field label="PIN code"><input className={inputClass} disabled={!admin} value={tenant.pincode ?? ""} onChange={(event) => setField("pincode", event.target.value)} /></Field>
          {admin ? <div className="sm:col-span-2"><Button type="submit">Save profile</Button></div> : <p className="text-sm text-slate-600 sm:col-span-2">Only an owner or admin can edit the business profile.</p>}
        </form>
      </Card>
      <Card>
        <h2 className="font-semibold">Team</h2>
        <ul className="mt-4 divide-y divide-slate-200 text-sm">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>{member.user?.name || member.user?.email || member.user_id}</span>
              {admin ? (
                <select className={inputClass} style={{ width: 140 }} value={member.role} onChange={(event) => void changeRole(member.id, event.target.value as Role)}>
                  {(["owner", "admin", "billing", "member"] as Role[]).map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              ) : (
                <span className="capitalize text-slate-500">{member.role}</span>
              )}
            </li>
          ))}
        </ul>
        <LockedFeature feature="multi_user_roles" label="Team roles">
        {admin ? (
          <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={invite}>
            <input className={inputClass} type="email" required placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <select className={inputClass} style={{ width: 160 }} value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<Role, "owner">)}>
              <option value="admin">admin</option>
              <option value="billing">billing</option>
              <option value="member">member</option>
            </select>
            <Button type="submit">Invite</Button>
          </form>
        ) : null}
        </LockedFeature>
      </Card>
      <Card>
        <h2 className="font-semibold">Channels</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li><Link className="font-semibold text-navy underline" href="/settings/payments">UPI ID and Razorpay keys</Link></li>
          <li><Link className="font-semibold text-navy underline" href="/whatsapp">WhatsApp click-to-chat and Cloud API</Link></li>
        </ul>
        <MessagingSettings />
      </Card>
      <Card>
        <h2 className="font-semibold">Plan</h2>
        <p className="mt-2 text-sm text-slate-600">You are on {tenant.plan}. Change it from Plans.</p>
      </Card>
    </div>
  );
}

interface MessagingSettingsBody {
  sms_provider: "none" | "msg91" | "twilio";
  email_provider: "none" | "smtp" | "resend";
  msg91_sender_id: string | null;
  msg91_dlt_template_id: string | null;
  twilio_from: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  resend_from: string | null;
  secrets_set?: Record<string, boolean>;
}

function MessagingSettings() {
  const [smsProvider, setSmsProvider] = useState<MessagingSettingsBody["sms_provider"]>("none");
  const [sender, setSender] = useState("");
  const [dlt, setDlt] = useState("");
  const [twilioFrom, setTwilioFrom] = useState("");
  const [emailProvider, setEmailProvider] = useState<MessagingSettingsBody["email_provider"]>("none");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("");
  const [smtpUser, setSmtpUser] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [msg91Key, setMsg91Key] = useState("");
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [resendKey, setResendKey] = useState("");
  const [secrets, setSecrets] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authed<MessagingSettingsBody>("/settings/messaging")
      .then((row) => {
        setSmsProvider(row.sms_provider ?? "none");
        setSender(row.msg91_sender_id ?? "");
        setDlt(row.msg91_dlt_template_id ?? "");
        setTwilioFrom(row.twilio_from ?? "");
        setEmailProvider(row.email_provider ?? "none");
        setSmtpHost(row.smtp_host ?? "");
        setSmtpPort(row.smtp_port ? String(row.smtp_port) : "");
        setSmtpUser(row.smtp_user ?? "");
        setResendFrom(row.resend_from ?? "");
        setSecrets(row.secrets_set ?? {});
      })
      .catch((reason: Error) => setProblem(reason.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading label="Loading SMS and email" />;

  return (
    <form
      className="mt-5 grid gap-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setProblem(null);
        setMessage(null);
        const body: Record<string, unknown> = {
          sms_provider: smsProvider,
          email_provider: emailProvider,
          msg91_sender_id: sender || undefined,
          msg91_dlt_template_id: dlt || undefined,
          twilio_from: twilioFrom || undefined,
          smtp_host: smtpHost || undefined,
          smtp_port: smtpPort ? Number(smtpPort) : undefined,
          smtp_user: smtpUser || undefined,
          resend_from: resendFrom || undefined,
        };
        if (msg91Key) body.msg91_auth_key = msg91Key;
        if (twilioSid) body.twilio_account_sid = twilioSid;
        if (twilioToken) body.twilio_auth_token = twilioToken;
        if (smtpPass) body.smtp_pass = smtpPass;
        if (resendKey) body.resend_api_key = resendKey;
        void authed<MessagingSettingsBody>("/settings/messaging", { method: "PUT", body: JSON.stringify(body) })
          .then((row) => {
            setSecrets(row.secrets_set ?? {});
            setMsg91Key("");
            setTwilioSid("");
            setTwilioToken("");
            setSmtpPass("");
            setResendKey("");
            setMessage("SMS and email settings saved. Secret keys are not shown again.");
          })
          .catch((reason: Error) => setProblem(reason.message));
      }}
    >
      <h3 className="font-semibold sm:col-span-2">SMS and email</h3>
      <p className="text-sm text-slate-600 sm:col-span-2">
        Secret keys are write-only. A saved key shows as on file, never as text.
      </p>
      <Field label="SMS provider">
        <select className={inputClass} value={smsProvider} onChange={(event) => setSmsProvider(event.target.value as MessagingSettingsBody["sms_provider"])}>
          <option value="none">None</option>
          <option value="msg91">MSG91</option>
          <option value="twilio">Twilio</option>
        </select>
      </Field>
      <Field label="MSG91 sender ID">
        <input className={inputClass} value={sender} onChange={(event) => setSender(event.target.value)} placeholder="BILFLW" />
      </Field>
      <Field label="DLT template id">
        <input className={inputClass} value={dlt} onChange={(event) => setDlt(event.target.value)} />
      </Field>
      <Field label="MSG91 auth key" hint={secrets.msg91_auth_key ? "A key is on file." : "Not saved yet."}>
        <input className={inputClass} type="password" autoComplete="off" value={msg91Key} onChange={(event) => setMsg91Key(event.target.value)} placeholder="Leave blank to keep the saved key" />
      </Field>
      <Field label="Twilio from number">
        <input className={inputClass} value={twilioFrom} onChange={(event) => setTwilioFrom(event.target.value)} />
      </Field>
      <Field label="Twilio account SID" hint={secrets.twilio_account_sid ? "A SID is on file." : "Not saved yet."}>
        <input className={inputClass} type="password" autoComplete="off" value={twilioSid} onChange={(event) => setTwilioSid(event.target.value)} />
      </Field>
      <Field label="Twilio auth token" hint={secrets.twilio_auth_token ? "A token is on file." : "Not saved yet."}>
        <input className={inputClass} type="password" autoComplete="off" value={twilioToken} onChange={(event) => setTwilioToken(event.target.value)} />
      </Field>
      <Field label="Email provider">
        <select className={inputClass} value={emailProvider} onChange={(event) => setEmailProvider(event.target.value as MessagingSettingsBody["email_provider"])}>
          <option value="none">None</option>
          <option value="resend">Resend</option>
          <option value="smtp">SMTP</option>
        </select>
      </Field>
      <Field label="Resend from address">
        <input className={inputClass} type="email" value={resendFrom} onChange={(event) => setResendFrom(event.target.value)} placeholder="invoices@yourdomain.in" />
      </Field>
      <Field label="Resend API key" hint={secrets.resend_api_key ? "A key is on file." : "Not saved yet."}>
        <input className={inputClass} type="password" autoComplete="off" value={resendKey} onChange={(event) => setResendKey(event.target.value)} />
      </Field>
      <Field label="SMTP host">
        <input className={inputClass} value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} />
      </Field>
      <Field label="SMTP port">
        <input className={inputClass} inputMode="numeric" value={smtpPort} onChange={(event) => setSmtpPort(event.target.value)} />
      </Field>
      <Field label="SMTP user">
        <input className={inputClass} value={smtpUser} onChange={(event) => setSmtpUser(event.target.value)} />
      </Field>
      <Field label="SMTP password" hint={secrets.smtp_pass ? "A password is on file." : "Not saved yet."}>
        <input className={inputClass} type="password" autoComplete="off" value={smtpPass} onChange={(event) => setSmtpPass(event.target.value)} />
      </Field>
      {problem ? <div className="sm:col-span-2"><ErrorNote message={problem} /></div> : null}
      {message ? <p className="text-sm sm:col-span-2">{message}</p> : null}
      <div className="sm:col-span-2"><Button type="submit">Save SMS and email</Button></div>
    </form>
  );
}
