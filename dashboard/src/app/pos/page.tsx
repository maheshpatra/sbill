"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Skeleton } from "@/components/ui";

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
  const [catalogLoading, setCatalogLoading] = useState(true);

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
        const tiles = flattenTiles(parsed);
        setProducts(tiles);
        if (tiles.length) setCatalogLoading(false);
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
      .catch(() => undefined)
      .finally(() => setCatalogLoading(false));
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

  function adjust(index: number, delta: number) {
    setReceipt(null);
    setCart((current) =>
      current.flatMap((line, lineIndex) => {
        if (lineIndex !== index) return [line];
        const quantity = line.quantity + delta;
        return quantity > 0 ? [{ ...line, quantity }] : [];
      }),
    );
  }

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
    <main className="min-h-screen bg-[#eef3f1] text-navy lg:grid lg:grid-cols-[minmax(0,1fr)_24rem]">
      {celebrating ? <SavedCheck label={t("receipt")} onDone={() => setCelebrating(false)} /> : null}
      <section className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-[#eef3f1]/90 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-teal">{online ? t("online") : t("offline")}</p>
              <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitch />
              <Link href="/" className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                {t("back")}
              </Link>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${online ? "bg-emerald/20 text-navy" : "bg-amber-100 text-amber-950"}`}>
              {online ? t("online") : t("offline")}
            </span>
            {pending > 0 ? <span className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white">{t("pending", { count: pending })}</span> : null}
          </div>
        </header>
        <div className="px-4 pt-4 lg:px-6">
          <FeatureBanner feature="pos" label={t("locked")} />
          {queue.length > 0 ? (
            <ul className="mb-3 space-y-2 text-sm">
              {queue.map((row) => (
                <li key={row.client_id} className="rounded-2xl border border-slate-200 bg-white px-3 py-2">
                  <span className="font-semibold">
                    {row.status === "exists" ? t("exists") : row.status === "conflict" ? t("conflict") : t("pendingNumber")}
                  </span>
                  <span className="ml-2 text-slate-600">{row.number || row.reason || row.lines.map((line) => line.description).join(", ")}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void parseVoice();
            }}
          >
            <label className="sr-only" htmlFor="pos-voice">{t("voice")}</label>
            <input id="pos-voice" className="h-12 min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-4" placeholder={t("voiceHint")} value={voice} onChange={(event) => setVoice(event.target.value)} />
            <button type="submit" className="shrink-0 rounded-2xl bg-navy px-4 text-sm font-semibold text-white">{t("voice")}</button>
          </form>
          <label className="sr-only" htmlFor="pos-search">{t("search")}</label>
          <input
            id="pos-search"
            className="mt-3 h-14 w-full rounded-2xl border border-slate-300 bg-white px-4 text-lg shadow-sm"
            placeholder={t("search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist">
            {chips.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={chip === item.id}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${chip === item.id ? "bg-navy text-white" : "border border-slate-200 bg-white text-navy"}`}
                onClick={() => chooseChip(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 content-start gap-3 px-4 py-4 sm:grid-cols-3 lg:grid-cols-3 lg:px-6 xl:grid-cols-4">
          {catalogLoading && visible.length === 0
            ? Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-32 rounded-3xl" />)
            : null}
          {!catalogLoading && visible.length === 0 ? <p className="col-span-full rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-600">{t("noGoods")}</p> : null}
          {visible.map((product) => {
            const qty = cart.find((line) => line.product_id === product.id)?.quantity ?? 0;
            return (
              <button
                key={product.id}
                type="button"
                className={`flex min-h-32 flex-col items-start justify-between rounded-3xl border bg-white p-4 text-left shadow-sm transition active:scale-[0.98] ${qty > 0 ? "border-emerald ring-2 ring-emerald/30" : "border-slate-200"}`}
                onClick={() => add(product)}
              >
                <span className="text-lg font-semibold leading-6">{product.name}</span>
                <span className="mt-3 flex w-full items-center justify-between text-sm">
                  <span className="font-semibold">{inr(product.price)}</span>
                  {qty > 0 ? <span className="rounded-full bg-emerald px-2.5 py-0.5 font-bold text-navy">{qty}</span> : <span className="text-xs font-semibold text-slate-400">+</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <aside className="sticky bottom-0 z-20 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(15,23,42,0.06)] lg:static lg:flex lg:h-screen lg:flex-col lg:border-t-0 lg:border-l lg:px-5 lg:pt-6 lg:shadow-none">
        <div className="mb-3 hidden lg:block">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal">{t("title")}</p>
          <h2 className="text-xl font-bold">{cart.length ? t("items", { count }) : t("emptyCart")}</h2>
        </div>
        {cart.length > 0 ? (
          <ul className="mb-3 max-h-36 space-y-2 overflow-y-auto lg:max-h-none lg:flex-1">
            {cart.map((line, index) => (
              <li key={`${line.product_id ?? line.description}-${index}`} className="flex items-center gap-2 rounded-2xl bg-[#f4f6f5] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{line.description}</p>
                  <p className="text-xs text-slate-500">{inr(line.unit_price)}{line.unit ? ` / ${line.unit}` : ""}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg font-bold" aria-label={`Remove one ${line.description}`} onClick={() => adjust(index, -1)}>−</button>
                  <span className="w-6 text-center text-sm font-bold tabular-nums">{line.quantity}</span>
                  <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg font-bold" aria-label={`Add one ${line.description}`} onClick={() => adjust(index, 1)}>+</button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 hidden text-sm text-slate-500 lg:block">{t("emptyCart")}</p>
        )}
        {preview ? (
          <p className="mb-3 text-sm text-slate-600">
            Tax {inr(preview.tax)} · <span className="font-semibold text-navy">{inr(preview.total)}</span>
          </p>
        ) : null}
        {note ? <p className="mb-2 text-sm text-navy">{note}</p> : null}
        {receipt ? (
          <p className="mb-2 text-sm font-semibold">
            {t("receipt")} {receipt.number} · {inr(receipt.total)}
            {receipt.change ? ` · ${t("change")} ${inr(receipt.change)}` : ""}
          </p>
        ) : null}
        <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label={t("collect")}>
          {(["cash", "upi"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`h-12 rounded-2xl text-base font-semibold ${method === value ? "bg-navy text-white" : "border border-slate-300 bg-white"}`}
              onClick={() => setMethod(value)}
            >
              {value === "cash" ? t("cash") : t("upi")}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!cart.length || busy}
          aria-busy={busy || undefined}
          className="flex h-16 w-full items-center justify-between rounded-3xl bg-emerald px-5 text-lg font-bold text-navy disabled:opacity-40"
          onClick={() => void collect()}
        >
          <span className="inline-flex items-center gap-2">
            {busy ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            {cart.length ? t("items", { count }) : t("emptyCart")}
          </span>
          <span>{preview ? `${t("collect")} ${inr(preview.total)}` : t("collect")}</span>
        </button>
      </aside>
    </main>
  );
}
