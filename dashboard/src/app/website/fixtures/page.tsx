"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Storefront, type PublicSite } from "@billflow/storefront";

function still(label: string, fill: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="100%" height="100%" fill="${fill}"/><text x="50%" y="52%" fill="#0f172a" font-size="72" font-family="sans-serif" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function sample(template: string, images: boolean): PublicSite {
  const goods = [
    { id: "tea", name: "Tea", price: 120, image_url: images ? still("T", "#10b981") : null },
    { id: "rice", name: "Rice", price: 80, image_url: images ? still("R", "#14b8a6") : null },
    { id: "oil", name: "Oil", price: 210, image_url: images ? still("O", "#0f172a") : null },
  ];
  return {
    name: "Sample shop",
    title: "Sample shop",
    tagline: "A local preview of the shop template.",
    about: "This about text sits beside the shop photo when one has been uploaded.",
    logo_url: images ? still("S", "#10b981") : null,
    hero_image_url: images ? still("Hero", "#10b981") : null,
    about_image_url: images ? still("About", "#14b8a6") : null,
    subdomain: "sample",
    locale: "en",
    template: { slug: template, name: template },
    config: {
      colors: { background: "#f8fafc", text: "#0f172a", accent: "#10b981", muted: "#64748b" },
      layout: { hero: template === "modern" ? "split" : "center" },
      sections: [
        { id: "hero", title: "Open today", body: "Cash or UPI at the counter.", enabled: true },
        { id: "about", title: "About the shop", body: "This about text sits beside the shop photo when one has been uploaded.", enabled: true },
      ],
    },
    bestsellers: goods,
    products: goods,
  };
}

function Fixture() {
  const params = useSearchParams();
  const template = params.get("template") || "modern";
  const images = params.get("images") !== "0";
  return (
    <div>
      <p style={{ margin: 0, padding: "8px 16px", background: "#fef3c7", color: "#0f172a", fontSize: 14 }}>
        Local preview. Test images are drawn in this page because hosted storage is not configured.
      </p>
      <Storefront site={sample(template, images)} />
    </div>
  );
}

export default function FixturePage() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}
