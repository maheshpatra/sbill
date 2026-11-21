import { createHmac } from 'crypto';

export interface CheckoutOrder {
  orderId: string;
  amountPaise: number;
  currency: 'INR';
}

export interface BillingProvider {
  readonly name: 'razorpay' | 'stripe';
  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<CheckoutOrder>;
}

export function verifyRazorpaySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  return digest.length === signature.length && digest === signature;
}

export class RazorpayProvider implements BillingProvider {
  readonly name = 'razorpay' as const;

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<CheckoutOrder> {
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: 'INR',
        receipt: input.receipt,
        notes: input.notes,
      }),
    });
    if (!response.ok) {
      throw new Error(`Razorpay order failed (${response.status})`);
    }
    const body = (await response.json()) as { id: string; amount: number };
    return { orderId: body.id, amountPaise: body.amount, currency: 'INR' };
  }
}

/** Stripe billing is not connected. The class exists so checkout can name the provider. */
export class StripeStubProvider implements BillingProvider {
  readonly name = 'stripe' as const;

  async createOrder(): Promise<CheckoutOrder> {
    throw new Error('Stripe is not connected. Use Razorpay for INR checkout.');
  }
}

export function platformTax(taxablePaise: number, sellerState: string, buyerState: string | null) {
  const tax = Math.round((taxablePaise * 18) / 100);
  if (buyerState && buyerState !== sellerState) {
    return { cgst: 0, sgst: 0, igst: tax, total: taxablePaise + tax, place: buyerState };
  }
  const cgst = Math.floor(tax / 2);
  return { cgst, sgst: tax - cgst, igst: 0, total: taxablePaise + tax, place: sellerState };
}
