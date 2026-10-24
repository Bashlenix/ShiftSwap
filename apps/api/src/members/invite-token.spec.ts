import { hashInviteToken, inviteLink, newInviteToken } from './invite-token';

describe('invite token', () => {
  it('is 32 random bytes as base64url (43 chars) and unique', () => {
    const a = newInviteToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newInviteToken().token).not.toBe(a.token);
  });

  it('stores only a SHA-256 hex hash that differs from the token', () => {
    const { token, tokenHash } = newInviteToken();
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toBe(token);
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  describe('inviteLink', () => {
    it('uses a trusted appOrigin', () => {
      expect(inviteLink('http://localhost:5173', {}, 'T')).toBe('http://localhost:5173/invites/T');
    });
    it('falls back to localhost for an untrusted or missing origin', () => {
      expect(inviteLink('https://evil.example', {}, 'T')).toBe('http://localhost:5173/invites/T');
      expect(inviteLink(undefined, {}, 'T')).toBe('http://localhost:5173/invites/T');
    });
  });
});
