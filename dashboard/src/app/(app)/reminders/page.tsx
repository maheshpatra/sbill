"use client";

import { useEffect, useState } from "react";
import { authed } from "@/lib/api";
import { FeatureBanner } from "@/components/feature-gate";
import { Button, Card, CardSkeleton, ErrorNote, inputClass } from "@/components/ui";

interface Schedule {
  offset_days: number;
  channel: "email" | "sms" | "whatsapp";
  template: string;
  enabled: boolean;
}

interface Job {
  id: string;
  invoice_id: string;
  channel: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
}

const defaults: Schedule[] = [
  { offset_days: -3, channel: "whatsapp", template: "Hello {{customer_name}}, invoice {{number}} for {{total}} is due on {{due_date}}.", enabled: true },
  { offset_days: 0, channel: "email", template: "Invoice {{number}} is due today. Amount {{total}}.", enabled: true },
  { offset_days: 3, channel: "sms", template: "Reminder: {{number}} is overdue. Please pay {{total}}.", enabled: true },
  { offset_days: 7, channel: "whatsapp", template: "{{customer_name}}, {{number}} is 7 days overdue.", enabled: true },
  { offset_days: 14, channel: "email", template: "Final reminder for {{number}}.", enabled: true },
];

export default function RemindersPage() {
  const [rows, setRows] = useState<Schedule[]>(defaults);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    Promise.all([
      authed<{ data: Schedule[] }>("/reminders/schedules"),
      authed<{ data: Job[] }>("/reminders/jobs"),
    ])
      .then(([schedules, history]) => {
        if (schedules.data.length) setRows(schedules.data);
        setJobs(history.data);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <CardSkeleton />;

  return (
    <div className="space-y-6">
      <FeatureBanner feature="auto_reminders" label="Automatic reminders" />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reminders</h1>
        <Button
          type="button"
          onClick={() =>
            void authed("/reminders/schedules", { method: "PUT", body: JSON.stringify({ schedules: rows }) })
              .then(() => setError(null))
              .catch((reason: Error) => setError(reason.message))
          }
        >
          Save schedules
        </Button>
      </div>
      <p className="text-sm text-slate-600">Offsets are days from the due date. The same invoice, offset, and channel is sent only once. Customers can opt out.</p>
      <ReminderPlan onError={setError} />
      {error ? <ErrorNote message={error} /> : null}
      <Card>
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <li key={`${row.offset_days}-${row.channel}-${index}`} className="grid gap-2 md:grid-cols-[90px_140px_1fr_auto]">
              <input className={inputClass} type="number" value={row.offset_days} onChange={(event) => update(index, { offset_days: Number(event.target.value) })} />
              <select className={inputClass} value={row.channel} onChange={(event) => update(index, { channel: event.target.value as Schedule["channel"] })}>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
              </select>
              <input className={inputClass} value={row.template} onChange={(event) => update(index, { template: event.target.value })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={row.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} />
                On
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">Variables: {'{{customer_name}} {{number}} {{total}} {{due_date}}'}</p>
      </Card>
      <Card>
        <h2 className="font-semibold">History</h2>
        {jobs.length === 0 ? <p className="mt-2 text-sm text-slate-600">No reminders have been queued.</p> : (
          <ul className="mt-3 divide-y text-sm">
            {jobs.map((job) => (
              <li key={job.id} className="flex justify-between py-2">
                <span className="capitalize">{job.channel} · {job.status} · attempts {job.attempts}</span>
                <span className="text-slate-500">{job.last_error || job.sent_at || ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

  function update(index: number, patch: Partial<Schedule>) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }
}

function ReminderPlan({ onError }: { onError: (message: string) => void }) {
  const [before, setBefore] = useState("3");
  const [onDue, setOnDue] = useState(true);
  const [after, setAfter] = useState("3, 7");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void authed<{ before_days: number[]; on_due: boolean; after_days: number[]; template?: string }>("/reminders/plan")
      .then((plan) => {
        setBefore((plan.before_days ?? []).join(", "));
        setOnDue(Boolean(plan.on_due));
        setAfter((plan.after_days ?? []).join(", "));
      })
      .catch((reason: Error) => onError(reason.message));
  }, [onError]);

  function days(value: string) {
    return value.split(",").map((part) => Number(part.trim())).filter((part) => Number.isFinite(part) && part > 0);
  }

  return (
    <Card>
      <h2 className="font-semibold">WhatsApp plan</h2>
      <p className="mt-1 text-sm text-slate-600">Days before the due date, on the day, and after.</p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void authed("/reminders/plan", {
            method: "PUT",
            body: JSON.stringify({ channel: "whatsapp", before_days: days(before), on_due: onDue, after_days: days(after) }),
          })
            .then(() => setNotice("Reminder plan saved."))
            .catch((reason: Error) => onError(reason.message));
        }}
      >
        <label className="text-sm">Before<input className={inputClass} value={before} onChange={(event) => setBefore(event.target.value)} /></label>
        <label className="text-sm">After<input className={inputClass} value={after} onChange={(event) => setAfter(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onDue} onChange={(event) => setOnDue(event.target.checked)} /> On the due date</label>
        <Button type="submit">Save plan</Button>
      </form>
      {notice ? <p className="mt-2 text-sm">{notice}</p> : null}
    </Card>
  );
}
