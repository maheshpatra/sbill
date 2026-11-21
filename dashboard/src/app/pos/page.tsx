"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { priceInvoice } from "@billflow/gst";
import { LanguageSwitch } from "@/i18n/provider";
import { FeatureBanner } from "@/components/feature-gate";
import { authed } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { listQueued, queueSale, type OfflineLine, type QueuedSale } from "@/lib/offline-queue";
import { inr, num } from "@/lib/money";
import { saleFromCart, syncQueuedSales } from "@/lib/sync-sales";
import { SavedCheck } from "@/components/saved-check";

interface Tile {
  id: string;
  name: string;
  unit?: string;
  price: number | string;
  gst_rate: number | string;
  category_id?: string | null;
}

interface TileCategory {
  id: string;
  name: string;
  tiles?: Tile[];
}

interface TilePayload {
  categories?: TileCategory[];
  uncategorized?: Tile[];
  favourites?: Tile[];
}

function flattenTiles(page: TilePayload): Tile[] {
  const rows: Tile[] = [];
  for (const category of page.categories ?? []) {
    for (const tile of category.tiles ?? []) rows.push({ ...tile, category_id: tile.category_id ?? category.id });
  }
  for (const tile of page.uncategorized ?? []) rows.push({ ...tile, category_id: null });
  if (!rows.length) {
    for (const tile of page.favourites ?? []) rows.push(tile);
  }
  return rows;
}

const CATALOG = "billflow-pos-tiles";

export default function QuickSalePage() {
  const t = useTranslations("quick");
  const router = useRouter();
  const { ready, session } = useAuth();
  const [products, setProducts] = useState<Tile[]>([]);
  const [categories, setCategories] = useState<TileCategory[]>([]);
  const [hasLoose, setHasLoose] = useState(false);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("all");
  const [cart, setCart] = useState<OfflineLine[]>([]);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [voice, setVoice] = useState("");
  const [method, setMethod] = useState<"cash" | "upi">("cash");
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ number: string; total: number; change?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    if (ready && !session) router.replace("/login");
  }, [ready, session, router]);

  useEffect(() => {
    const cached = localStorage.getItem(CATALOG);
    if (cached) {
      const parsed = JSON.parse(cached) as TilePayload;
      if (parsed && !Array.isArray(parsed)) {
        setCategories(parsed.categories ?? []);
        setHasLoose(Boolean(parsed.uncategorized?.length));
        setProducts(flattenTiles(parsed));
      }
    }
    setOnline(navigator.onLine);
    void refreshPending();
    function on() {
      setOnline(true);
      void syncQueuedSales().then(async (result) => {
        await refreshPending();
        if (result.error === "missing") setNote(t("syncWaiting"));
      });
    }
    function off() {
      setOnline(false);
    }
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [t]);

  useEffect(() => {
    if (!session) return;
    void authed<TilePayload>("/pos/tiles")
      .then((page) => {
        const tiles = flattenTiles(page);
        setCategories(page.categories ?? []);
        setHasLoose(Boolean(page.uncategorized?.length));
        if (tiles.length) setProducts(tiles);
        localStorage.setItem(CATALOG, JSON.stringify(page));
      })
      .catch(() => undefined);
  }, [session]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      if (chip === "none" && product.category_id) return false;
      if (chip !== "all" && chip !== "none" && product.category_id !== chip) return false;
      if (!q) return true;
      return product.name.toLowerCase().includes(q);
    });
  }, [products, query, chip]);

  const preview = useMemo(() => {
    if (!cart.length) return null;
    return priceInvoice(
      cart.map((line) => ({ quantity: line.quantity, unitPrice: line.unit_price, gstRate: line.gst_rate })),
      "intra",
    );
  }, [cart]);

  const count = cart.reduce((sum, line) => sum + line.quantity, 0);

  function add(product: Tile) {
    setReceipt(null);
    setNote(null);
    setCart((current) => {
      const found = current.find((line) => line.product_id === product.id);
      if (found) return current.map((line) => (line.product_id === product.id ? { ...line, quantity: line.quantity + 1 } : line));
      return [
        ...current,
        {
          product_id: /^[0-9a-f-]{36}$/i.test(product.id) ? product.id : undefined,
          description: product.name,
          quantity: 1,
          unit_price: num(product.price),
          gst_rate: num(product.gst_rate),
          unit: product.unit,
          discount: 0,
        },
      ];
    });
  }

  async function refreshPending() {
    const rows = await listQueued();
    setQueue(rows);
    setPending(rows.filter((row) => row.status === "pending").length);
  }

  async function collect() {
    if (!preview || !cart.length) return;
    setBusy(true);
    setNote(null);
    const total = num(preview.total);
    const sale = saleFromCart({ method, tendered: total, changeGiven: 0, lines: cart });
    const live = typeof navigator === "undefined" ? online : navigator.onLine;
    try {
      if (!live) {
        setOnline(false);
        await queueSale(sale);
        await refreshPending();
        setCart([]);
        setNote(t("queued"));
        return;
      }
      const result = await authed<{ number: string; total: number; change_given?: number }>("/pos/checkout", {
        method: "POST",
        body: JSON.stringify({
          walk_in_name: "Walk-in",
          method,
          tendered: total,
          change_given: 0,
          lines: cart,
        }),
      });
      setCart([]);
      setReceipt({ number: result.number, total: num(result.total), change: result.change_given });
      setCelebrating(true);
    } catch {
      await queueSale(sale);
      await refreshPending();
      setCart([]);
      setNote(t("queued"));
    } finally {
      setBusy(false);
    }
  }

  const chips = [
    { id: "all", label: t("all") },
    ...categories.map((category) => ({ id: category.id, label: category.name })),
    ...(hasLoose ? [{ id: "none", label: t("uncategorized") }] : []),
  ];

  function chooseChip(id: string) {
    setChip(id);
    if (id === "all" || id === "none" || !navigator.onLine) return;
    void authed<TilePayload>(`/pos/tiles?category_id=${id}`)
      .then((page) => {
        const tiles = flattenTiles(page);
        if (!tiles.length) return;
        setProducts((current) => {
          const rest = current.filter((tile) => tile.category_id !== id);
          return [...rest, ...tiles];
        });
      })
      .catch(() => undefined);
  }

  async function parseVoice() {
    if (!voice.trim()) return;
    setNote(null);
    try {
      const parsed = await authed<{ lines: Array<{ description: string; quantity: number; unit_price: number | null; product_id: string | null; unit?: string }> }>("/voice/parse", {
        method: "POST",
        body: JSON.stringify({ text: voice.trim(), locale: document.documentElement.lang === "bn" ? "bn" : "en" }),
      });
      parsed.lines.forEach((line) => {
        const product = products.find((item) => item.id === line.product_id) ?? products.find((item) => item.name.toLowerCase() === line.description.toLowerCase());
        add({
          id: line.product_id || product?.id || line.description,
          name: line.description,
          price: line.unit_price ?? product?.price ?? 0,
          gst_rate: product?.gst_rate ?? 0,
          unit: line.unit || product?.unit,
          category_id: product?.category_id,
        });
      });
      setVoice("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      setNote(/not configured|503/i.test(message) ? t("notSetUp") : message);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#f4f6f5] text-navy">
      {celebrating ? <SavedCheck label={t("receipt")} onDone={() => setCelebrating(false)} /> : null}
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal">{online ? t("online") : t("offline")}</p>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <Link href="/" className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
            {t("back")}
          </Link>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 px-4">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${online ? "bg-emerald/20 text-navy" : "bg-amber-100 text-amber-950"}`}>
          {online ? t("online") : t("offline")}
        </span>
        {pending > 0 ? <span className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white">{t("pending", { count: pending })}</span> : null}
      </div>
      {queue.length > 0 ? (
        <ul className="mx-4 mt-3 space-y-2 text-sm">
          {queue.map((row) => (
            <li key={row.client_id} className="rounded-2xl bg-white px-3 py-2">
              <span className="font-semibold">
                {row.status === "exists" ? t("exists") : row.status === "conflict" ? t("conflict") : t("pendingNumber")}
              </span>
              <span className="ml-2 text-slate-600">{row.number || row.reason || row.lines.map((line) => line.description).join(", ")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="px-4 pt-3">
        <FeatureBanner feature="pos" label={t("locked")} />
        <form
          className="mb-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void parseVoice();
          }}
        >
          <input className="h-12 flex-1 rounded-2xl border border-slate-300 bg-white px-4" placeholder={t("voiceHint")} value={voice} onChange={(event) => setVoice(event.target.value)} />
          <button type="submit" className="rounded-2xl bg-navy px-4 text-sm font-semibold text-white">{t("voice")}</button>
        </form>
        <input
          id="pos-search"
          className="h-14 w-full rounded-2xl border border-slate-300 bg-white px-4 text-lg"
          placeholder={t("search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-3 flex gap-2 overflow-x-auto" role="tablist">
          {chips.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={chip === item.id}
              className={`min-h-12 shrink-0 rounded-full px-4 text-sm font-semibold ${chip === item.id ? "bg-navy text-white" : "bg-white text-navy"}`}
              onClick={() => chooseChip(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid flex-1 grid-cols-2 content-start gap-3 px-4 py-4 sm:grid-cols-3 lg:grid-cols-4">
        {visible.length === 0 ? <p className="col-span-full text-sm text-slate-600">{t("noGoods")}</p> : null}
        {visible.map((product) => {
          const qty = cart.find((line) => line.product_id === product.id)?.quantity ?? 0;
          return (
            <button
              key={product.id}
              type="button"
              className="flex min-h-32 flex-col items-start justify-between rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm active:bg-emerald/10"
              onClick={() => add(product)}
            >
              <span className="text-lg font-semibold leading-6">{product.name}</span>
              <span className="mt-3 flex w-full items-center justify-between text-sm">
                <span className="font-semibold">{inr(product.price)}</span>
                {qty > 0 ? <span className="rounded-full bg-emerald px-2 py-0.5 font-bold text-navy">{qty}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <footer className="sticky bottom-0 z-20 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {note ? <p className="mb-2 text-sm text-navy">{note}</p> : null}
        {receipt ? (
          <p className="mb-2 text-sm font-semibold">
            {t("receipt")} {receipt.number} · {inr(receipt.total)}
          </p>
        ) : null}
        <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label={t("collect")}>
          {(["cash", "upi"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`h-12 rounded-2xl text-base font-semibold ${method === value ? "bg-navy text-white" : "border border-slate-300"}`}
              onClick={() => setMethod(value)}
            >
              {value === "cash" ? t("cash") : t("upi")}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!cart.length || busy}
          className="flex h-16 w-full items-center justify-between rounded-3xl bg-emerald px-5 text-lg font-bold text-navy disabled:opacity-40"
          onClick={() => void collect()}
        >
          <span>{cart.length ? t("items", { count }) : t("emptyCart")}</span>
          <span>{preview ? `${t("collect")} ${inr(preview.total)}` : t("collect")}</span>
        </button>
      </footer>
    </main>
  );
}
