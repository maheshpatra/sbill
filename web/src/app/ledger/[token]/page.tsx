export default async function PublicLedgerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const api = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4317";
  const [ledgerResponse, upiResponse] = await Promise.all([
    fetch(`${api}/public/ledger/${token}`, { cache: "no-store" }),
    fetch(`${api}/public/ledger/${token}/upi`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  ]);
  if (!ledgerResponse.ok) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-bold text-navy">This ledger link is not available</h1>
        <p className="mt-2 text-slate-600">It may have been revoked.</p>
      </main>
    );
  }
  const ledger = (await ledgerResponse.json()) as {
    shop?: { name?: string; logo_url?: string | null };
    customer?: { name?: string } | string;
    balance?: number;
    invoices?: Array<{ number?: string; total?: number; status?: string }>;
    razorpay_available?: boolean;
  };
  const upi = upiResponse.ok
    ? ((await upiResponse.json()) as { upi_uri?: string | null; qr_svg?: string | null; razorpay_available?: boolean; balance?: number })
    : null;
  const name = typeof ledger.customer === "string" ? ledger.customer : ledger.customer?.name;
  const razorpay = Boolean(upi?.razorpay_available ?? ledger.razorpay_available);
  const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-navy">
      {ledger.shop?.logo_url ? <img src={ledger.shop.logo_url} alt="" className="mb-3 h-12 w-12 rounded-xl object-cover" /> : null}
      <p className="text-sm text-teal">{ledger.shop?.name}</p>
      <h1 className="mt-2 text-3xl font-bold">{name}</h1>
      <p className="mt-4 text-sm text-slate-600">Dues</p>
      <p className="text-3xl font-bold">{money.format(Number(upi?.balance ?? ledger.balance ?? 0))}</p>
      {upi?.qr_svg ? <div className="mt-6 w-52" dangerouslySetInnerHTML={{ __html: upi.qr_svg }} /> : null}
      {upi?.upi_uri ? (
        <a className="mt-4 inline-flex min-h-12 items-center rounded-full bg-emerald px-5 text-sm font-bold text-navy" href={upi.upi_uri}>
          Pay with UPI
        </a>
      ) : (
        <p className="mt-4 text-sm text-slate-600">UPI is not set up for this shop yet.</p>
      )}
      {razorpay ? null : (
        <button type="button" className="mt-3 block min-h-12 rounded-full border border-slate-300 px-5 text-sm text-slate-400" disabled>
          Card pay unavailable
        </button>
      )}
      <ul className="mt-6 space-y-2 text-sm">
        {(ledger.invoices ?? []).map((row) => (
          <li key={row.number} className="flex justify-between gap-3">
            <span>{row.number}</span>
            <span>{row.total}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
