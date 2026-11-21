import { resolveHost, resolveRequestHost } from '@billflow/host-resolution';

describe('resolveHost', () => {
  it('sends the apex and www to marketing and app to the dashboard', () => {
    expect(resolveHost('billflow.com').kind).toBe('marketing');
    expect(resolveHost('www.billflow.com').kind).toBe('marketing');
    expect(resolveHost('app.billflow.com').kind).toBe('dashboard');
    expect(resolveHost('localhost').kind).toBe('dashboard');
  });

  it('extracts a tenant slug and leaves other hosts as custom domains', () => {
    expect(resolveHost('acme.billflow.com')).toEqual({
      kind: 'tenant-subdomain',
      host: 'acme.billflow.com',
      slug: 'acme',
    });
    expect(resolveHost('Acme.localhost:4318')).toEqual({
      kind: 'tenant-subdomain',
      host: 'acme.localhost',
      slug: 'acme',
    });
    expect(resolveHost('pay.saffronretail.in')).toEqual({
      kind: 'custom-domain',
      host: 'pay.saffronretail.in',
    });
    expect(resolveHost('www').kind).not.toBe('tenant-subdomain');
  });

  it('honors ?host= only on localhost', () => {
    expect(resolveRequestHost('localhost:4318', 'acme.localhost')).toEqual({
      kind: 'tenant-subdomain',
      host: 'acme.localhost',
      slug: 'acme',
    });
    expect(resolveRequestHost('billflow.com', 'evil.example').kind).toBe('marketing');
    expect(resolveRequestHost('pay.saffronretail.in', 'acme.billflow.com').kind).toBe('custom-domain');
  });
});
