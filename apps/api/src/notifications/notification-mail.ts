import {
  notificationPath,
  notificationText,
  type NotificationPayload,
  type NotificationType,
} from '@shiftswap/shared';
import { escapeHtml } from '../mail/escape-html';
import type { MailMessage } from '../mail/mail.service';

export function buildNotificationMail(args: {
  to: string;
  orgName: string;
  timeZone: string;
  orgId: string;
  baseUrl: string;
  type: NotificationType;
  payload: NotificationPayload;
  recipientMembershipId: string;
}): MailMessage {
  const n = { type: args.type, payload: args.payload };
  const text = notificationText(n, args.timeZone);
  const link = args.baseUrl + notificationPath(args.orgId, n);
  const footer = `You get this email because you are a member of ${args.orgName} on ShiftSwap.`;
  return {
    to: args.to,
    subject: `${args.orgName}: ${text.replace(/\.$/, '')}`,
    text: [text, '', `Open ShiftSwap: ${link}`, '', footer].join('\n'),
    html:
      `<p>${escapeHtml(text)}</p>` +
      `<p><a href="${escapeHtml(link)}">Open ShiftSwap</a></p>` +
      `<p>${escapeHtml(footer)}</p>`,
    kind: args.type,
    recipientMembershipId: args.recipientMembershipId,
  };
}
