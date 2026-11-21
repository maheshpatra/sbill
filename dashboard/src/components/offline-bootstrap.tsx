"use client";

import { useEffect } from "react";
import { syncQueuedSales } from "@/lib/sync-sales";

export function OfflineBootstrap() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    function online() {
      void syncQueuedSales();
    }
    window.addEventListener("online", online);
    void syncQueuedSales();
    return () => window.removeEventListener("online", online);
  }, []);
  return null;
}
