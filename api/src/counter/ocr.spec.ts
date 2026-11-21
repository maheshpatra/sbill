import { draftFromOcrText } from './ocr';

describe('bill photo draft', () => {
  it('reads a JSON extraction from the provider', () => {
    const draft = draftFromOcrText(JSON.stringify({
      supplier: 'Saffron Stores',
      lines: [{ description: 'Rice', quantity: 2, unit_price: 25, line_total: 50 }],
      total: 50,
    }), 'openai');
    expect(draft.supplier).toBe('Saffron Stores');
    expect(draft.lines).toHaveLength(1);
    expect(draft.provider).toBe('openai');
  });

  it('reads loose bill lines', () => {
    const draft = draftFromOcrText('Supplier: Northwind\nRice  2  50\nDal  1  80');
    expect(draft.supplier).toBe('Northwind');
    expect(draft.lines.map((line) => line.description)).toEqual(['Rice', 'Dal']);
    expect(draft.total).toBe(130);
  });
});
