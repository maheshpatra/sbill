export interface CashSettlement {
  due: number;
  tendered: number;
  /** What the cashier handed back. May be less than the extra when the customer leaves it. */
  changeGiven: number;
  /** Portion that settles the invoice. A full payment always applies the amount due. */
  applied: number;
}

export class CashPaymentError extends Error {}

function rupees(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Cash tender rules.
 * The counter must receive at least the amount due. Change can be lowered, which does not reduce the bill.
 * An invoice may apply only part of the cash.
 */
export function settleCash(input: {
  due: number;
  tendered: number;
  changeGiven?: number | null;
  allowPartial: boolean;
}): CashSettlement {
  const due = rupees(input.due);
  const tendered = rupees(input.tendered);
  if (due <= 0) throw new CashPaymentError('nothing is due');
  if (!Number.isFinite(tendered) || tendered <= 0) throw new CashPaymentError('enter the cash received');
  if (!input.allowPartial && tendered + 0.001 < due) {
    throw new CashPaymentError('cash received must cover the amount due');
  }

  const extra = rupees(Math.max(0, tendered - due));
  const suggested = input.allowPartial ? extra : rupees(tendered - due);
  const changeGiven = input.changeGiven == null ? suggested : rupees(input.changeGiven);
  if (changeGiven < 0 || changeGiven - tendered > 0.001) {
    throw new CashPaymentError('change cannot be more than the cash received');
  }

  if (!input.allowPartial) {
    if (changeGiven - extra > 0.001) {
      throw new CashPaymentError('change cannot be more than the extra cash');
    }
    return { due, tendered, changeGiven, applied: due };
  }

  const applied = rupees(tendered - changeGiven);
  if (applied <= 0) throw new CashPaymentError('the cash applied to the bill must be greater than zero');
  if (applied - due > 0.001) throw new CashPaymentError('cash applied cannot exceed the amount due');
  return { due, tendered, changeGiven, applied };
}
