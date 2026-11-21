export interface CashSettlement {
  due: number;
  tendered: number;
  changeGiven: number;
  applied: number;
}

export class CashPaymentError extends Error {}

function rupees(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Same rules as the API. The counter covers the bill. An invoice may take a part payment. */
export function settleCash(input: {
  due: number;
  tendered: number;
  changeGiven?: number | null;
  allowPartial: boolean;
}): CashSettlement {
  const due = rupees(input.due);
  const tendered = rupees(input.tendered);
  if (due <= 0) throw new CashPaymentError("nothing is due");
  if (!Number.isFinite(tendered) || tendered <= 0) throw new CashPaymentError("enter the cash received");
  if (!input.allowPartial && tendered + 0.001 < due) {
    throw new CashPaymentError("cash received must cover the amount due");
  }

  const extra = rupees(Math.max(0, tendered - due));
  const suggested = input.allowPartial ? extra : rupees(tendered - due);
  const changeGiven = input.changeGiven == null ? suggested : rupees(input.changeGiven);
  if (changeGiven < 0 || changeGiven - tendered > 0.001) {
    throw new CashPaymentError("change cannot be more than the cash received");
  }

  if (!input.allowPartial) {
    if (changeGiven - extra > 0.001) {
      throw new CashPaymentError("change cannot be more than the extra cash");
    }
    return { due, tendered, changeGiven, applied: due };
  }

  const applied = rupees(tendered - changeGiven);
  if (applied <= 0) throw new CashPaymentError("the cash applied to the bill must be greater than zero");
  if (applied - due > 0.001) throw new CashPaymentError("cash applied cannot exceed the amount due");
  return { due, tendered, changeGiven, applied };
}

export const NOTE_AMOUNTS = [100, 200, 500, 2000];

export type PayMethod = "cash" | "upi" | "online" | "card";

export function rememberPayMethod(method: PayMethod) {
  localStorage.setItem("billflow-last-pay-method", method);
}

export function rememberedPayMethod(): PayMethod | null {
  const value = localStorage.getItem("billflow-last-pay-method");
  if (value === "cash" || value === "upi" || value === "online" || value === "card") return value;
  return null;
}
