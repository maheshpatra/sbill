export interface PurchaseLine {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface PurchaseDraft {
  supplier: string | null;
  lines: PurchaseLine[];
  total: number | null;
  provider: string;
}

export function draftFromOcrText(text: string, provider = 'rules'): PurchaseDraft {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as { supplier?: string; lines?: PurchaseLine[]; total?: number };
      const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
      return {
        supplier: parsed.supplier ?? null,
        lines,
        total: parsed.total ?? lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0),
        provider,
      };
    } catch {
      // Fall through to line parsing.
    }
  }
  const lines: PurchaseLine[] = [];
  let supplier: string | null = null;
  for (const raw of trimmed.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const supplierMatch = line.match(/^(?:supplier|from|দোকান)\s*[:：]\s*(.+)$/i);
    if (supplierMatch) {
      supplier = supplierMatch[1].trim();
      continue;
    }
    const parts = line.split(/\s{2,}|\t|\s*\|\s*/).filter(Boolean);
    if (parts.length >= 3) {
      const quantity = Number(parts[1].replace(/[^\d.]/g, ''));
      const amount = Number(parts[parts.length - 1].replace(/[^\d.]/g, ''));
      if (quantity > 0 && amount >= 0) {
        lines.push({
          description: parts[0],
          quantity,
          unit_price: Math.round((amount / quantity) * 100) / 100,
          line_total: amount,
        });
      }
    }
  }
  const total = lines.reduce((sum, line) => sum + line.line_total, 0);
  return { supplier, lines, total: lines.length ? total : null, provider };
}
