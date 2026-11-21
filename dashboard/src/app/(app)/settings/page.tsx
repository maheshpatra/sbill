"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, ErrorNote, Field, Loading, inputClass } from "@/components/ui";
import { authed } from "@/lib/api";
import { canAdmin } from "@/lib/access";
import type { Me, Member, Role, Tenant } from "@/lib/types";

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
    try {
      const updated = await authed<Tenant>("/tenants/current", {
        method: "PATCH",
        body: JSON.stringify({
          name: tenant.name,
          legal_name: tenant.legal_name,
          gstin: tenant.gstin,
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

  if (loading) return <Loading />;
  if (!tenant || !me) return <ErrorNote message={error ?? "Could not load settings"} onRetry={load} />;

  const admin = canAdmin(me.user?.role);
  function setField<K extends keyof Tenant>(key: K, value: Tenant[K]) {
    setTenant((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm">{notice}</p> : null}
      <Card>
        <h2 className="font-semibold">Business profile</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
          <Field label="Name"><input className={inputClass} disabled={!admin} value={tenant.name} onChange={(event) => setField("name", event.target.value)} /></Field>
          <Field label="Legal name"><input className={inputClass} disabled={!admin} value={tenant.legal_name ?? ""} onChange={(event) => setField("legal_name", event.target.value)} /></Field>
          <Field label="GSTIN"><input className={inputClass} disabled={!admin} value={tenant.gstin ?? ""} onChange={(event) => setField("gstin", event.target.value.toUpperCase())} /></Field>
          <p className="text-sm text-slate-600 sm:col-span-2"><Link className="font-semibold text-navy underline" href="/settings/payments">UPI payment settings</Link> hold the VPA and the name shown in the payer&apos;s app.</p>
          <Field label="Email"><input className={inputClass} disabled={!admin} value={tenant.email ?? ""} onChange={(event) => setField("email", event.target.value)} /></Field>
          <Field label="Phone"><input className={inputClass} disabled={!admin} value={tenant.phone ?? ""} onChange={(event) => setField("phone", event.target.value)} /></Field>
          <Field label="Address"><input className={inputClass} disabled={!admin} value={tenant.address_line1 ?? ""} onChange={(event) => setField("address_line1", event.target.value)} /></Field>
          <Field label="City"><input className={inputClass} disabled={!admin} value={tenant.city ?? ""} onChange={(event) => setField("city", event.target.value)} /></Field>
          <Field label="State"><input className={inputClass} disabled={!admin} value={tenant.state ?? ""} onChange={(event) => setField("state", event.target.value)} /></Field>
          <Field label="State code"><input className={inputClass} disabled={!admin} value={tenant.state_code ?? ""} onChange={(event) => setField("state_code", event.target.value)} /></Field>
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
      </Card>
      <Card>
        <h2 className="font-semibold">Plan</h2>
        <p className="mt-2 text-sm text-slate-600">You are on {tenant.plan}. Change it from Plans.</p>
      </Card>
    </div>
  );
}
