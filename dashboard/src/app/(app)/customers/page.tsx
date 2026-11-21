"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, ErrorNote, ListSkeleton } from "@/components/ui";
import { authed } from "@/lib/api";
import { canWrite } from "@/lib/access";
import type { Customer, Me, Page } from "@/lib/types";

export default function CustomersPage() {
  const [rows, setRows] = useState<Customer[]>([]);
  const [role, setRole] = useState<Me["user"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    Promise.all([authed<Page<Customer>>("/customers?limit=100"), authed<Me>("/auth/me")])
      .then(([page, me]) => {
        setRows(page.data);
        setRole(me.user);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
        {canWrite(role?.role) ? (
          <Link href="/customers/new" className="rounded-full bg-emerald px-4 py-2 text-sm font-semibold text-navy">New customer</Link>
        ) : null}
      </div>
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {loading ? <ListSkeleton /> : null}
      {!loading && rows.length === 0 ? <Empty title="No customers yet" body="Add the people and shops you invoice." /> : null}
      <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
        {rows.map((customer) => (
          <li key={customer.id}>
            <Link href={`/customers/${customer.id}`} className="block px-4 py-3 hover:bg-slate-50">
              <span className="font-semibold">{customer.name}</span>
              <span className="ml-2 text-sm text-slate-500">{customer.email || customer.gstin || customer.phone}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
