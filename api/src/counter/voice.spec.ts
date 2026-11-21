import { parseVoiceTranscript } from './voice';

describe('voice billing parse', () => {
  it('reads Bengali numerals, units, and a rupee total', () => {
    const lines = parseVoiceTranscript('দুই কেজি চাল, পঞ্চাশ টাকা', [
      { id: 'rice', name: 'চাল', unit: 'kg', price: 20 },
    ]);
    expect(lines).toEqual([
      {
        description: 'চাল',
        quantity: 2,
        unit: 'kg',
        unit_price: 25,
        line_total: 50,
        product_id: 'rice',
      },
    ]);
  });

  it('reads an English phrase when no catalog row matches', () => {
    const lines = parseVoiceTranscript('2 kg sugar and 40 rupees');
    expect(lines[0]).toMatchObject({ description: 'sugar', quantity: 2, unit: 'kg', unit_price: 20, product_id: null });
  });
});
