"use client";

import { useEffect, useRef, useState } from "react";

export function OtpInput({
  value,
  onChange,
  disabled,
  id = "otp-code",
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const digits = value.replace(/\D/g, "").slice(0, 6);

  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {Array.from({ length: 6 }, (_, index) => {
          const filled = Boolean(digits[index]);
          const active = digits.length === index;
          return (
            <span
              key={index}
              className={`flex h-14 items-center justify-center rounded-2xl border bg-white text-2xl font-bold tabular-nums ${
                active ? "border-teal" : filled ? "border-navy" : "border-slate-300"
              }`}
            >
              {digits[index] ?? ""}
            </span>
          );
        })}
      </div>
      <label className="sr-only" htmlFor={id}>
        6-digit code
      </label>
      <input
        ref={inputRef}
        id={id}
        className="absolute inset-0 z-10 h-full w-full cursor-text text-[16px] text-transparent caret-transparent"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        pattern="[0-9]*"
        value={digits}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </div>
  );
}

export function useCooldown(seconds = 60) {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  return {
    left,
    start() {
      setLeft(seconds);
    },
  };
}
