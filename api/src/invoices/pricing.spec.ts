import { priceInvoice, priceLine } from '@billflow/gst';

describe('GST totals', () => {
  it('matches the Acme seed invoice: 2 x 10000 at 18% intra-state', () => {
    expect(priceLine({ quantity: 2, unitPrice: 10000, gstRate: 18 }, 'intra')).toEqual({
      taxableValue: '20000.00',
      cgst: '1800.00',
      sgst: '1800.00',
      igst: '0.00',
      tax: '3600.00',
      total: '23600.00',
    });
  });

  it('puts the whole tax in IGST for an inter-state supply', () => {
    expect(priceLine({ quantity: 1, unitPrice: 8000, gstRate: 18 }, 'inter').igst).toBe('1440.00');
  });

  it('prices a filing line the way mark-paid expects', () => {
    const invoice = priceInvoice([{ quantity: 1, unitPrice: 1000, gstRate: 18 }], 'intra');
    expect(invoice.total).toBe('1180.00');
    expect(invoice.cgst).toBe('90.00');
    expect(invoice.sgst).toBe('90.00');
  });

  it('rejects a discount larger than the invoice', () => {
    expect(() => priceInvoice([{ quantity: 1, unitPrice: 100, gstRate: 0 }], 'intra', 101)).toThrow(
      /discount/,
    );
  });
});
