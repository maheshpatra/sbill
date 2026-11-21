"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

export function ImageCropper({
  label,
  maxEdge,
  current,
  onSave,
}: {
  label: string;
  maxEdge: number;
  current?: string | null;
  onSave: (dataUrl: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    return () => {
      if (source) URL.revokeObjectURL(source);
    };
  }, [source]);

  function choose(file: File) {
    setError(null);
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 2_000_000) {
      setError("That image is over 2 MB.");
      return;
    }
    if (source) URL.revokeObjectURL(source);
    setSource(URL.createObjectURL(file));
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function save() {
    const image = imageRef.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = maxEdge;
    canvas.height = maxEdge;
    const context = canvas.getContext("2d");
    if (!context) return;
    const base = Math.max(maxEdge / image.naturalWidth, maxEdge / image.naturalHeight) * zoom;
    const width = image.naturalWidth * base;
    const height = image.naturalHeight * base;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, maxEdge, maxEdge);
    context.drawImage(image, (maxEdge - width) / 2 + offset.x, (maxEdge - height) / 2 + offset.y, width, height);
    let quality = 0.82;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > 180_000 && quality > 0.5) {
      quality -= 0.1;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    onSave(data);
    setSource(null);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{label}</p>
      {current ? <img src={current} alt="" className="h-16 w-16 rounded-full object-cover" /> : <p className="text-sm text-slate-500">No image yet.</p>}
      <input
        className="block text-sm"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) choose(file);
        }}
      />
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {source ? (
        <div className="space-y-3">
          <div
            className="relative h-48 w-48 overflow-hidden rounded-2xl bg-slate-100"
            onPointerDown={(event) => {
              drag.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              setOffset({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          >
            <img
              ref={imageRef}
              src={source}
              alt="Crop preview"
              className="absolute max-w-none"
              style={{
                width: `${zoom * 100}%`,
                left: `calc(50% + ${offset.x}px)`,
                top: `calc(50% + ${offset.y}px)`,
                transform: "translate(-50%, -50%)",
              }}
            />
          </div>
          <label className="block text-sm">
            Zoom
            <input className="mt-1 block w-full" type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <Button type="button" onClick={save}>Use this crop</Button>
        </div>
      ) : null}
    </div>
  );
}
