"use client";

import { useEffect, useState } from "react";
import { LockedFeature } from "@/components/feature-gate";
import { Button, Card, Empty, ErrorNote, Field, ListSkeleton, inputClass } from "@/components/ui";
import { ImageCropper } from "@/components/image-cropper";
import { ApiError, authed } from "@/lib/api";
import { publishImage } from "@/lib/brand-assets";
import { canWrite } from "@/lib/access";
import { inr } from "@/lib/money";
import type { Me } from "@/lib/types";

interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn_sac: string | null;
  unit: string | null;
  price: number | string;
  gst_rate: number | string;
  stock: number | string | null;
  category_id?: string | null;
  image_url?: string | null;
}

interface Category {
  id: string;
  name: string;
  sort_order: number;
}

const blank = { name: "", sku: "", barcode: "", hsn_sac: "", unit: "pcs", price: "", gst_rate: "18", stock: "", category_id: "", image_url: "" };
const LOCAL_PHOTOS = "billflow-product-photos";

function localPhotos() {
  if (typeof window === "undefined") return {} as Record<string, string>;
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PHOTOS) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export default function ProductsPage() {
  const [rows, setRows] = useState<Product[]>([]);
  const [role, setRole] = useState<Me["user"]>(null);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  function load() {
    setLoading(true);
    Promise.all([
      authed<{ data: Product[] }>("/products"),
      authed<Me>("/auth/me"),
      authed<{ data: Category[] }>("/product-categories").catch(() => ({ data: [] as Category[] })),
    ])
      .then(([page, me, categoryPage]) => {
        setRows(page.data);
        setRole(me.user);
        setCategories(categoryPage.data ?? []);
        setPhotos(localPhotos());
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function payload() {
    return {
      name: form.name.trim(),
      sku: form.sku || undefined,
      barcode: form.barcode || undefined,
      hsn_sac: form.hsn_sac || undefined,
      unit: form.unit || undefined,
      price: Number(form.price),
      gst_rate: Number(form.gst_rate || 0),
      stock: form.stock === "" ? undefined : Number(form.stock),
      category_id: form.category_id || undefined,
      image_url: form.image_url.startsWith("https://") ? form.image_url : form.image_url === "" ? "" : undefined,
    };
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = payload();
      const path = editing ? `/products/${editing}` : "/products";
      const method = editing ? "PUT" : "POST";
      let saved: { id: string };
      try {
        saved = await authed<{ id: string }>(path, { method, body: JSON.stringify(body) });
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 400 || !("image_url" in body)) throw reason;
        const { image_url: _image, ...rest } = body;
        void _image;
        saved = await authed<{ id: string }>(path, { method, body: JSON.stringify(rest) });
      }
      if (form.image_url.startsWith("data:") && saved?.id) {
        const next = { ...localPhotos(), [saved.id]: form.image_url };
        localStorage.setItem(LOCAL_PHOTOS, JSON.stringify(next));
        setPhotos(next);
      }
      setNotice(editing ? "Product updated." : "Product added.");
      setForm(blank);
      setEditing(null);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the product");
    } finally {
      setBusy(false);
    }
  }

  const writable = canWrite(role?.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Products</h1>
        <p className="mt-1 text-sm text-slate-600">Prices are tax-exclusive. The counter and invoices pick from this list.</p>
      </div>
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {notice ? <p className="rounded-xl bg-emerald/15 px-3 py-2 text-sm">{notice}</p> : null}
      <LockedFeature feature="product_catalog" label="Product catalog">
        <Card>
          <h2 className="font-semibold">Categories</h2>
          <p className="mt-1 text-sm text-slate-600">These names become the chips on the counter.</p>
          <ul className="mt-3 divide-y text-sm">
            {categories.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-semibold">{category.name}</span>
                {writable ? (
                  <span className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => { setEditingCategory(category.id); setCategoryName(category.name); }}>Edit</Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        void authed(`/product-categories/${category.id}`, { method: "DELETE" })
                          .then(() => load())
                          .catch((reason: Error) => setError(reason.message))
                      }
                    >
                      Delete
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {writable ? (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const body = JSON.stringify({ name: categoryName.trim(), sort_order: categories.length });
                const path = editingCategory ? `/product-categories/${editingCategory}` : "/product-categories";
                void authed(path, { method: editingCategory ? "PUT" : "POST", body })
                  .then(() => {
                    setCategoryName("");
                    setEditingCategory(null);
                    load();
                  })
                  .catch((reason: Error) => setError(reason.message));
              }}
            >
              <input className={`${inputClass} max-w-xs`} required placeholder="Category name" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
              <Button type="submit">{editingCategory ? "Update category" : "Add category"}</Button>
            </form>
          ) : null}
        </Card>
        {loading ? <ListSkeleton /> : null}
        {!loading && rows.length === 0 ? (
          <Empty title="No products yet" body="Add the things you sell. Stock counts wait for the Growth plan." />
        ) : null}
        {!loading && rows.length > 0 ? (
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white text-sm">
            {rows.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <ProductThumb name={product.name} url={product.image_url || photos[product.id]} />
                  <div>
                  <p className="font-semibold text-navy">{product.name}</p>
                  <p className="text-slate-500">
                    {[product.sku, product.hsn_sac ? `HSN ${product.hsn_sac}` : null, product.barcode].filter(Boolean).join(" · ") || "No SKU"}
                  </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-semibold">{inr(product.price)}</p>
                    <p className="text-xs text-slate-500">GST {product.gst_rate}%{product.stock != null ? ` · stock ${product.stock}` : ""}</p>
                  </div>
                  {writable ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditing(product.id);
                        setForm({
                          name: product.name,
                          sku: product.sku ?? "",
                          barcode: product.barcode ?? "",
                          hsn_sac: product.hsn_sac ?? "",
                          unit: product.unit ?? "pcs",
                          price: String(product.price),
                          gst_rate: String(product.gst_rate),
                          stock: product.stock == null ? "" : String(product.stock),
                          category_id: product.category_id ?? "",
                          image_url: product.image_url || photos[product.id] || "",
                        });
                      }}
                    >
                      Edit
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {writable ? (
          <Card className="mt-4">
            <h2 className="font-semibold">{editing ? "Edit product" : "Add a product"}</h2>
            <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
              <div className="sm:col-span-2">
                <ImageCropper
                  label="Product photo"
                  maxEdge={800}
                  current={form.image_url || null}
                  onSave={(dataUrl) => {
                    void publishImage("product", dataUrl).then((result) => {
                      setForm((current) => ({ ...current, image_url: result.url }));
                      if (result.message) setNotice(result.message);
                    }).catch((reason: Error) => setError(reason.message));
                  }}
                />
              </div>
              <Field label="Name">
                <input className={inputClass} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field label="Price (excl. GST)">
                <input className={inputClass} required inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} />
              </Field>
              <Field label="SKU">
                <input className={inputClass} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
              </Field>
              <Field label="Barcode">
                <input className={inputClass} value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
              </Field>
              <Field label="HSN / SAC">
                <input className={inputClass} value={form.hsn_sac} onChange={(event) => setForm({ ...form, hsn_sac: event.target.value })} />
              </Field>
              <Field label="Category">
                <select className={inputClass} value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="GST %">
                <input className={inputClass} inputMode="decimal" value={form.gst_rate} onChange={(event) => setForm({ ...form, gst_rate: event.target.value })} />
              </Field>
              <Field label="Unit">
                <input className={inputClass} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
              </Field>
              <LockedFeature feature="stock_tracking" label="Stock tracking">
                <Field label="Stock on hand">
                  <input className={inputClass} inputMode="decimal" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} />
                </Field>
              </LockedFeature>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" loading={busy}>{busy ? "Saving…" : editing ? "Update product" : "Add product"}</Button>
                {editing ? (
                  <Button type="button" variant="ghost" onClick={() => { setEditing(null); setForm(blank); }}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>
        ) : (
          <p className="mt-4 text-sm text-slate-600">Members can look through the catalog. Billing, admins, and owners can change it.</p>
        )}
      </LockedFeature>
    </div>
  );
}

function ProductThumb({ name, url }: { name: string; url?: string | null }) {
  if (url) return <img src={url} alt="" className="h-12 w-12 rounded-lg object-cover" />;
  return <span className="grid h-12 w-12 place-items-center rounded-lg bg-slate-200 text-sm font-bold">{(name.trim()[0] || "?").toUpperCase()}</span>;
}
