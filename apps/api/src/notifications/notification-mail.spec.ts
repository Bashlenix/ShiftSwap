import { buildNotificationMail } from './notification-mail';

const base = {
  to: 'a@example.com',
  orgName: 'Café Lindenhof',
  timeZone: 'Europe/Berlin',
  orgId: 'o1',
  baseUrl: 'http://localhost:5173',
  type: 'OFFER_APPROVED' as const,
  payload: {
    role: 'selected' as const,
    shiftStartAt: '2026-11-06T17:00:00Z',
    shiftEndAt: '2026-11-06T22:00:00Z',
  },
  recipientMembershipId: 'm1',
};

describe('buildNotificationMail', () => {
  it('builds subject and text with the deep link', () => {
    const mail = buildNotificationMail(base);
    expect(mail.subject).toBe('Café Lindenhof: You got the shift Fri 6 Nov, 18:00–23:00');
    expect(mail.text).toContain('Open ShiftSwap: http://localhost:5173/orgs/o1/me/shifts');
    expect(mail.text).toContain(
      'You get this email because you are a member of Café Lindenhof on ShiftSwap.',
    );
    expect(mail.html).toContain('<a href="http://localhost:5173/orgs/o1/me/shifts">Open ShiftSwap</a>');
  });

  it('escapes the organisation name in the HTML', () => {
    const mail = buildNotificationMail({ ...base, orgName: '<b>X</b>' });
    expect(mail.html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>X</b>');
  });

  it('uses the notification type as kind', () => {
    const mail = buildNotificationMail(base);
    expect(mail.kind).toBe('OFFER_APPROVED');
    expect(mail.recipientMembershipId).toBe('m1');
    expect(mail.to).toBe('a@example.com');
  });
});
