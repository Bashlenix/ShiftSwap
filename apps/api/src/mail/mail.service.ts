import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** What the mail is for (e.g. INVITE); logged on failure. */
  kind: string;
  recipientMembershipId: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;
  private readonly from: string;
  private readonly capture: boolean;

  /** Messages captured by the json transport (tests only). */
  readonly sent: Array<{ to: string; subject: string; text: string }> = [];

  constructor() {
    const env = process.env;
    this.from = env.MAIL_FROM ?? 'ShiftSwap <no-reply@shiftswap.test>';
    this.capture = env.MAIL_TRANSPORT === 'json';
    this.transport = this.capture
      ? createTransport({ jsonTransport: true })
      : createTransport({
          host: env.SMTP_HOST ?? 'mailpit',
          port: Number(env.SMTP_PORT ?? 1025),
          secure: false,
          ignoreTLS: true,
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 10000,
        });
  }

  /** Never throws; failures are logged with IDs only (never the address). */
  async send(msg: MailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      if (this.capture) this.sent.push({ to: msg.to, subject: msg.subject, text: msg.text });
    } catch {
      this.logger.warn({ kind: msg.kind, recipientMembershipId: msg.recipientMembershipId });
    }
  }
}
