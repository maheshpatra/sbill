import { BadRequestException } from '@nestjs/common';

const HTTPS = /^https:\/\/\S+$/i;

export function httpsImageUrl(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be an https URL`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!HTTPS.test(trimmed)) {
    throw new BadRequestException(`${field} must be an https URL`);
  }
  return trimmed;
}

export function withHttpsSiteImages(overrides: Record<string, unknown>) {
  const next = { ...overrides };
  for (const field of ['hero_image_url', 'about_image_url'] as const) {
    if (!Object.prototype.hasOwnProperty.call(next, field)) continue;
    next[field] = httpsImageUrl(next[field], field);
  }
  return next;
}
