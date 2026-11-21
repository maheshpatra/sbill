import { renderTemplate, waMeLink } from './providers';

describe('message helpers', () => {
  it('fills reminder variables and builds a wa.me link', () => {
    expect(renderTemplate('Hi {{customer_name}}, pay {{total}}', { customer_name: 'Mehta', total: '₹100' })).toBe(
      'Hi Mehta, pay ₹100',
    );
    expect(waMeLink('9876543210', 'Invoice INV-1')).toContain('https://wa.me/919876543210?text=');
  });
});
