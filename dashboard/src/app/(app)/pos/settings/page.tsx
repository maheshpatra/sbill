"use client";

import { useEffect, useState } from "react";
import { authed } from "@/lib/api";
import { Button, Card, ErrorNote, Field, Loading, inputClass } from "@/components/ui";

export default function PosSettingsPage() {
  const [tax, setTax] = useState("18");
  const [footer, setFooter] = useState("Thank you.");
  const [width, setWidth] = useState<58 | 80>(80);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authed<{ default_tax_rate: number; receipt_footer: string; paper_width: 58 | 80 }>("/pos/settings")
      .then((row) => {
        setTax(String(row.default_tax_rate));
        setFooter(row.receipt_footer);
        setWidth(row.paper_width);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;

  return (
    <Card className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold">POS settings</h1>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void authed("/pos/settings", {
            method: "PUT",
            body: JSON.stringify({ default_tax_rate: Number(tax), receipt_footer: footer, paper_width: width }),
          }).catch((reason: Error) => setError(reason.message));
        }}
      >
        <Field label="Default GST %"><input className={inputClass} value={tax} onChange={(event) => setTax(event.target.value)} /></Field>
        <Field label="Receipt footer"><textarea className={inputClass} rows={3} value={footer} onChange={(event) => setFooter(event.target.value)} /></Field>
        <Field label="Paper width">
          <select className={inputClass} value={width} onChange={(event) => setWidth(Number(event.target.value) as 58 | 80)}>
            <option value={58}>58mm</option>
            <option value={80}>80mm</option>
          </select>
        </Field>
        {error ? <ErrorNote message={error} /> : null}
        <Button type="submit">Save</Button>
      </form>
    </Card>
  );
}
