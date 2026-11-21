import { pageSize, renderInvoicePdf, resolveTemplateKey } from './render-pdf';

describe('invoice templates', () => {
  it('uses the invoice key, then the tenant default, then classic', () => {
    expect(resolveTemplateKey({ template_key: 'bold', default_template: 'minimal' })).toBe('bold');
    expect(resolveTemplateKey({ default_template: 'minimal' })).toBe('minimal');
    expect(resolveTemplateKey({})).toBe('classic');
  });

  it('gives thermal templates a narrow page', () => {
    expect(pageSize('thermal_58')).toEqual([164, 600]);
    expect(pageSize('thermal_80')).toEqual([227, 700]);
    expect(pageSize('classic')).toBe('A4');
  });

  it('renders a Bengali template to a PDF', async () => {
    const pdf = await renderInvoicePdf({ template_key: 'bengali', number: 'INV-1', total: 50, locale: 'bn' }, 'পঞ্চাশ টাকা');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
