import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type SupplyType = 'intra' | 'inter';

export interface GstLineInput {
  quantity: number | string;
  unitPrice: number | string;
  /** Total GST percent, for example 18. Split into CGST+SGST or IGST from the supply type. */
  gstRate: number | string;
}

export interface GstLine {
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  total: string;
}

export interface GstInvoice {
  lines: GstLine[];
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  discount: string;
  total: string;
}

function money(value: Decimal): string {
  return value.toDecimalPlaces(2).toFixed(2);
}

function dec(value: number | string): Decimal {
  return new Decimal(value);
}

/**
 * Tax-exclusive line. Matches the database trigger:
 * taxable = round(quantity * unit_price, 2)
 * tax = round(taxable * rate / 100, 2)
 * intra-state tax is split into CGST and SGST, with the extra paisa on SGST.
 */
export function priceLine(input: GstLineInput, supply: SupplyType): GstLine {
  const taxable = dec(input.quantity).mul(dec(input.unitPrice)).toDecimalPlaces(2);
  const tax = taxable.mul(dec(input.gstRate)).div(100).toDecimalPlaces(2);
  let cgst = new Decimal(0);
  let sgst = new Decimal(0);
  let igst = new Decimal(0);
  if (supply === 'inter') {
    igst = tax;
  } else {
    cgst = tax.div(2).toDecimalPlaces(2);
    sgst = tax.minus(cgst);
  }
  return {
    taxableValue: money(taxable),
    cgst: money(cgst),
    sgst: money(sgst),
    igst: money(igst),
    tax: money(tax),
    total: money(taxable.plus(tax)),
  };
}

export {
  financialYear,
  formatFyInvoiceNumber,
  gstinChecksum,
  isValidGstin,
  rupeesInWords,
  supplyFromStates,
} from "./india";

export function priceInvoice(
  lines: GstLineInput[],
  supply: SupplyType,
  discount: number | string = 0,
): GstInvoice {
  const priced = lines.map((line) => priceLine(line, supply));
  const sum = (key: keyof GstLine) =>
    priced.reduce((acc, line) => acc.plus(line[key]), new Decimal(0));
  const taxable = sum('taxableValue');
  const tax = sum('tax');
  const disc = dec(discount).toDecimalPlaces(2);
  const total = taxable.plus(tax).minus(disc);
  if (total.isNegative()) {
    throw new Error('discount exceeds invoice total');
  }
  return {
    lines: priced,
    taxableValue: money(taxable),
    cgst: money(sum('cgst')),
    sgst: money(sum('sgst')),
    igst: money(sum('igst')),
    tax: money(tax),
    discount: money(disc),
    total: money(total),
  };
}
