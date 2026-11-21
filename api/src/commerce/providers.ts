export interface OutboundMessage {
  to: string;
  body: string;
  subject?: string;
  templateId?: string;
  variables?: Record<string, string>;
}

export interface SendResult {
  provider: string;
  providerId?: string;
  skipped?: boolean;
}

export interface MessageSender {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}

export function renderTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, key: string) => variables[key] ?? '');
}

export function waMeLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, '');
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}

export class MetaWhatsAppSender implements MessageSender {
  readonly name = 'meta-whatsapp';

  constructor(
    private readonly phoneNumberId: string,
    private readonly token: string,
    private readonly templateName: string,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const response = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.to.replace(/\D/g, ''),
        type: 'template',
        template: {
          name: this.templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: Object.values(message.variables ?? { body: message.body }).map((text) => ({
                type: 'text',
                text,
              })),
            },
          ],
        },
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message: string } };
    if (!response.ok) throw new Error(payload.error?.message || `WhatsApp API ${response.status}`);
    return { provider: this.name, providerId: payload.messages?.[0]?.id };
  }
}

export class Msg91Sender implements MessageSender {
  readonly name = 'msg91';

  constructor(
    private readonly authKey: string,
    private readonly senderId: string,
    private readonly templateId: string,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const response = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: this.authKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: message.templateId || this.templateId,
        sender: this.senderId,
        recipients: [{ mobiles: message.to.replace(/\D/g, ''), var: message.body }],
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { type?: string; message?: string; request_id?: string };
    if (!response.ok || payload.type === 'error') throw new Error(payload.message || `MSG91 ${response.status}`);
    return { provider: this.name, providerId: payload.request_id };
  }
}

export class TwilioSender implements MessageSender {
  readonly name = 'twilio';

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const body = new URLSearchParams({ To: message.to, From: this.from, Body: message.body });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const payload = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!response.ok) throw new Error(payload.message || `Twilio ${response.status}`);
    return { provider: this.name, providerId: payload.sid };
  }
}

export class ResendSender implements MessageSender {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject || 'Invoice from billflow',
        text: message.body,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) throw new Error(payload.message || `Resend ${response.status}`);
    return { provider: this.name, providerId: payload.id };
  }
}

export class SmtpSender implements MessageSender {
  readonly name = 'smtp';

  constructor(
    private readonly transport: { sendMail: (input: Record<string, string>) => Promise<{ messageId?: string }> },
    private readonly from: string,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const result = await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject || 'Invoice from billflow',
      text: message.body,
    });
    return { provider: this.name, providerId: result.messageId };
  }
}
