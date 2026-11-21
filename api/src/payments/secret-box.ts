import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** AES-256-GCM. The key is PAYMENT_SECRETS_KEY, 32 bytes encoded as base64. */
export function encryptSecret(plain: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('PAYMENT_SECRETS_KEY must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString('base64');
}

export function decryptSecret(payload: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('PAYMENT_SECRETS_KEY must be 32 bytes');
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  const digest = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  const left = Buffer.from(digest);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string, webhookSecret: string): boolean {
  if (!signature || !webhookSecret) return false;
  const digest = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  const left = Buffer.from(digest);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
