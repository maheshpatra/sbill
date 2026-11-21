import { buildUpiUri, formatUpiAmount, UPI_VPA } from '@billflow/upi';

describe('UPI URI', () => {
  it('builds a collect request with an amount and note', () => {
    const uri = buildUpiUri({
      pa: 'acme@okhdfcbank',
      pn: 'Acme Traders',
      am: 23600,
      tn: 'Invoice INV-0001',
      tr: 'INV-0001',
    });
    expect(uri.startsWith('upi://pay?')).toBe(true);
    expect(uri).toContain('pa=acme%40okhdfcbank');
    expect(uri).toContain('am=23600.00');
    expect(uri).toContain('cu=INR');
    expect(uri).toContain('tn=Invoice%20INV-0001');
    expect(uri).toContain('tr=INV-0001');
    expect(uri.indexOf('tn=')).toBeLessThan(uri.indexOf('tr='));
    expect(uri.indexOf('tr=')).toBeLessThan(uri.indexOf('cu='));
  });

  it('encodes spaces, ampersands, and unicode in the payee name', () => {
    const uri = buildUpiUri({
      pa: 'shop@ybl',
      pn: 'A & B राज',
      am: '10',
      tr: 'BF001',
    });
    expect(uri).toContain('pn=A%20%26%20B%20%E0%A4%B0%E0%A4%BE%E0%A4%9C');
    expect(uri).not.toContain('+');
    expect(uri).not.toContain('&B');
  });

  it('rounds the amount to paise and keeps two decimals', () => {
    expect(formatUpiAmount('10.005')).toBe('10.01');
    expect(formatUpiAmount('10.004')).toBe('10.00');
    expect(formatUpiAmount(10.1)).toBe('10.10');
    expect(buildUpiUri({ pa: 'shop@ybl', pn: 'Shop', am: '10.005', tr: 'T1' })).toContain('am=10.01');
  });

  it('keeps the transaction note at 50 characters', () => {
    const note = 'न'.repeat(60);
    const uri = buildUpiUri({ pa: 'shop@ybl', pn: 'Shop', tn: note, tr: 'T2' });
    const tn = new URL(uri).searchParams.get('tn') ?? '';
    expect(Array.from(tn)).toHaveLength(50);
  });

  it('rejects a VPA that does not match the payment-address pattern', () => {
    expect(UPI_VPA.test('acme@okhdfcbank')).toBe(true);
    expect(() => buildUpiUri({ pa: 'not-a-vpa', pn: 'Acme' })).toThrow(/VPA/);
    expect(() => buildUpiUri({ pa: 'bad handle@ok', pn: 'Acme' })).toThrow(/VPA/);
    expect(() => buildUpiUri({ pa: 'shop@12', pn: 'Acme' })).toThrow(/VPA/);
  });
});
