import { CashPaymentError, settleCash } from './cash';

describe('cash settlement', () => {
  it('applies the amount due and returns the extra notes', () => {
    expect(settleCash({ due: 236, tendered: 500, allowPartial: false })).toEqual({
      due: 236,
      tendered: 500,
      changeGiven: 264,
      applied: 236,
    });
  });

  it('lets the cashier keep the change without reducing the amount applied', () => {
    expect(settleCash({ due: 236, tendered: 500, changeGiven: 0, allowPartial: false })).toMatchObject({
      applied: 236,
      changeGiven: 0,
    });
  });

  it('rejects a short tender at the counter', () => {
    expect(() => settleCash({ due: 236, tendered: 200, allowPartial: false })).toThrow(CashPaymentError);
    expect(() => settleCash({ due: 236, tendered: 200, allowPartial: false })).toThrow(/cover the amount due/);
  });

  it('allows a partial cash payment on an invoice', () => {
    expect(settleCash({ due: 236, tendered: 100, changeGiven: 0, allowPartial: true })).toMatchObject({
      applied: 100,
      changeGiven: 0,
    });
  });

  it('rejects change that is larger than the cash received', () => {
    expect(() => settleCash({ due: 50, tendered: 100, changeGiven: 120, allowPartial: true })).toThrow(/change/);
  });
});
