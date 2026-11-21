"use client";

export function ConfirmDialog({
  title,
  body,
  confirm,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="pop-sheet fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-6">
        <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded-full px-4 py-2 text-sm font-semibold" onClick={onClose}>Cancel</button>
          <button type="button" className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}
