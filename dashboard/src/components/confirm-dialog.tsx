"use client";

import { Button } from "./ui";

export function ConfirmDialog({
  title,
  body,
  confirm,
  pending = false,
  error,
  children,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  pending?: boolean;
  error?: string | null;
  children?: React.ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="pop-sheet fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-6">
        <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        {children ? <div className="mt-4">{children}</div> : null}
        {error ? <p className="mt-3 text-sm text-rose-700" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" variant="danger" loading={pending} onClick={onConfirm}>{confirm}</Button>
        </div>
      </div>
    </div>
  );
}
