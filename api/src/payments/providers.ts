import { BadRequestException, Injectable } from '@nestjs/common';
import { buildUpiUri } from '@billflow/upi';

export interface ChargeRequest {
  amount: string;
  currency: string;
  payeeName: string;
  vpa?: string | null;
  note?: string;
  reference?: string;
}

export interface PreparedCharge {
  method: string;
  upi_uri?: string;
  transaction_ref?: string;
}

export interface PaymentProvider {
  readonly name: string;
  prepare(input: ChargeRequest): PreparedCharge;
}

@Injectable()
export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual';

  prepare(input: ChargeRequest): PreparedCharge {
    return { method: 'other', transaction_ref: input.reference };
  }
}

@Injectable()
export class UpiPaymentProvider implements PaymentProvider {
  readonly name = 'upi';

  prepare(input: ChargeRequest): PreparedCharge {
    if (!input.vpa) throw new BadRequestException('This tenant has no UPI VPA');
    try {
      return {
        method: 'upi',
        transaction_ref: input.reference,
        upi_uri: buildUpiUri({
          pa: input.vpa,
          pn: input.payeeName,
          am: input.amount,
          cu: input.currency || 'INR',
          tn: input.note,
          tr: input.reference,
        }),
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid UPI details');
    }
  }
}
