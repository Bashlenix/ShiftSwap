import type { MailMessage } from '../mail/mail.service';

/** "31 Oct 2026" in the organisation's time zone. */
export function formatExpiry(expiresAt: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(expiresAt);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('day')} ${get('month')} ${get('year')}`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildInviteMail(args: {
  to: string;
  orgName: string;
  link: string;
  expiresAt: Date;
  timeZone: string;
  membershipId: string;
}): MailMessage {
  const expiry = formatExpiry(args.expiresAt, args.timeZone);
  const text = [
    `You have been invited to join ${args.orgName} on ShiftSwap.`,
    '',
    `Accept the invitation: ${args.link}`,
    '',
    `This link expires on ${expiry}.`,
  ].join('\n');
  const html =
    `<p>You have been invited to join <strong>${escapeHtml(args.orgName)}</strong> on ShiftSwap.</p>` +
    `<p><a href="${escapeHtml(args.link)}">Accept the invitation</a></p>` +
    `<p>This link expires on ${expiry}.</p>`;
  return {
    to: args.to,
    subject: `You're invited to ${args.orgName} on ShiftSwap`,
    text,
    html,
    kind: 'INVITE',
    recipientMembershipId: args.membershipId,
  };
}
