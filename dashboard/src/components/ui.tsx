import { cn } from "@/lib/cn";
import type { InvoiceStatus } from "@/lib/types";

const tones: Record<InvoiceStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-[#14B8A6]/15 text-[#0f766e]",
  paid: "bg-[#10B981]/20 text-[#065f46]",
  partially_paid: "bg-sky-100 text-sky-900",
  overdue: "bg-amber-100 text-amber-900",
  void: "bg-slate-200 text-slate-500",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize", tones[status])}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "navy" | "ghost" | "outline" | "danger" }) {
  const styles = {
    primary: "bg-emerald text-navy hover:bg-teal",
    navy: "bg-navy text-white hover:bg-slate-800",
    ghost: "bg-transparent text-navy hover:bg-slate-100",
    outline: "border border-slate-300 bg-white text-navy hover:bg-slate-50",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
  }[variant];
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-sm font-medium text-navy">
      {label}
      <div className="mt-1.5">{children}</div>
      {hint ? <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-teal";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-slate-200 bg-white p-5", className)}>{children}</section>;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="font-semibold text-navy">{title}</p>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="mt-2 font-semibold underline" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p className="text-sm text-slate-500" role="status">
      {label}…
    </p>
  );
}
