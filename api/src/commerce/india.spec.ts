import { financialYear, formatFyInvoiceNumber, gstinChecksum, isValidGstin, normalizeGstin, rupeesInWords, supplyFromStates } from '@billflow/gst';

describe('India GST helpers', () => {
  it('checks a GSTIN checksum against itself', () => {
    const body = '27AAAAA0000A1Z';
    const gstin = body + gstinChecksum(body);
    expect(isValidGstin(gstin)).toBe(true);
    expect(isValidGstin(`${body}0`)).toBe(false);
    expect(isValidGstin('not-a-gstin')).toBe(false);
    expect(normalizeGstin('  27aaaaa0000a1z5  ')).toBe('27AAAAA0000A1Z5');
    expect(normalizeGstin('')).toBeNull();
    expect(normalizeGstin('   ')).toBeNull();
    expect(normalizeGstin(null)).toBeNull();
  });

  it('keeps financial-year invoice numbers within 16 characters', () => {
    const fy = financialYear(new Date('2026-04-01T00:00:00+05:30'));
    expect(fy).toBe('2627');
    expect(financialYear(new Date('2026-03-31T00:00:00+05:30'))).toBe('2526');
    const number = formatFyInvoiceNumber('INV', '2627', 1);
    expect(number.length).toBeLessThanOrEqual(16);
    expect(number.startsWith('INV2627')).toBe(true);
  });

  it('splits supply by state and spells rupees', () => {
    expect(supplyFromStates('27', '27')).toBe('intra');
    expect(supplyFromStates('27', '33')).toBe('inter');
    expect(supplyFromStates('27', '')).toBe('intra');
    expect(rupeesInWords(1180)).toBe('Rupees One Thousand One Hundred Eighty Only');
    expect(rupeesInWords(23600)).toBe('Rupees Twenty Three Thousand Six Hundred Only');
    expect(rupeesInWords(0.5)).toBe('Rupees Zero and Fifty Paise Only');
  });
});
