import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';

const msg = {
  to: 'secret.person@example.com',
  subject: 'Hello',
  text: 'Body',
  html: '<p>Body</p>',
  kind: 'INVITE',
  recipientMembershipId: 'm-1',
};

describe('MailService', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('records messages with the json transport', async () => {
    process.env.MAIL_TRANSPORT = 'json';
    const mail = new MailService();
    await mail.send(msg);
    expect(mail.sent).toEqual([{ to: msg.to, subject: 'Hello', text: 'Body', html: msg.html }]);
  });

  it('resolves and warns without the address when SMTP is unreachable', async () => {
    delete process.env.MAIL_TRANSPORT;
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1';
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const mail = new MailService();
    await expect(mail.send(msg)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('INVITE');
    expect(logged).toContain('m-1');
    expect(logged).not.toContain('secret.person');
    expect(mail.sent).toEqual([]);
  });
});
