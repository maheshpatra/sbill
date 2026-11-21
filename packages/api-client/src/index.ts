import createClient, { type Client } from 'openapi-fetch';
import type { paths } from './schema';

export type BillflowPaths = paths;

/** Typed fetch client generated from api/openapi.json. */
export function createBillflowClient(options: { baseUrl: string; token?: string }): Client<paths> {
  return createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/$/, ''),
    headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
  });
}
