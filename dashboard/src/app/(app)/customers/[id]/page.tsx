"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerForm } from "@/components/customer-form";
import { Button, CardSkeleton, ErrorNote } from "@/components/ui";
import { authed } from "@/lib/api";
import { canWrite } from "@/lib/access";
import type { Customer, Me } from "@/lib/types";

export default function EditCustomerPage() {
  const params = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([authed<Customer>(`/customers/${params.id}`), authed<Me>("/auth/me")])
      .then(([row, me]) => {
        setCustomer(row);
        setWritable(canWrite(me.user?.role));
      })
      .catch((reason: Error) => setError(reason.message));
  }, [params.id]);

  if (error) return <ErrorNote message={error} />;
  if (!customer) return <CardSkeleton cards={2} />;
  if (!writable) {
    return (
      <div>
        <h1 className="text-2xl font-bold">{customer.name}</h1>
        <p className="mt-2 text-sm text-slate-600">{customer.email}</p>
        <p className="text-sm text-slate-600">{customer.gstin}</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Edit {customer.name}</h1>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() =>
            void authed<{ url: string }>(`/customers/${customer.id}/ledger-link`, { method: "POST" })
              .then((row) => setLink(row.url))
              .catch((reason: Error) => setError(reason.message))
          }
        >
          Ledger link
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void authed(`/customers/${customer.id}/ledger-link/revoke`, { method: "POST" })
              .then(() => setLink(null))
              .catch((reason: Error) => setError(reason.message))
          }
        >
          Revoke link
        </Button>
      </div>
      {link ? <p className="break-all text-sm">{link}</p> : null}
      <CustomerForm
        id={customer.id}
        initial={{
          name: customer.name,
          email: customer.email ?? "",
          phone: customer.phone ?? "",
          company: customer.company ?? "",
          gstin: customer.gstin ?? "",
          notes: customer.notes ?? "",
        }}
      />
    </div>
  );
}
