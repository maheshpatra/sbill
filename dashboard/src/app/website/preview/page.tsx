"use client";

import { useEffect, useState } from "react";
import { Storefront, type PublicSite } from "@billflow/storefront";

export default function WebsitePreviewPage() {
  const [site, setSite] = useState<PublicSite | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "billflow-preview" && event.data.site) {
        setSite(event.data.site as PublicSite);
      }
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "billflow-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!site) {
    return <p style={{ fontFamily: "Outfit, sans-serif", padding: 24 }}>Waiting for the editor…</p>;
  }
  return <Storefront site={site} />;
}
