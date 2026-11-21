"use client";

import { useEffect } from "react";

export function SavedCheck({ label, onDone }: { label: string; onDone?: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone?.(), 4000);
    return () => window.clearTimeout(timer);
    // Close once; a new callback identity should not restart the mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="pop-sheet fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-6" role="status">
      <div className="rounded-3xl bg-white px-8 py-6 text-center shadow-xl">
        <svg className="saved-check mx-auto h-16 w-16 text-emerald" viewBox="0 0 52 52" aria-hidden>
          <circle className="saved-ring" cx="26" cy="26" r="23" fill="none" stroke="currentColor" strokeWidth="2" />
          <path className="saved-mark" d="M15 27 l8 8 l15-16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="mt-3 text-lg font-semibold">{label}</p>
      </div>
    </div>
  );
}
