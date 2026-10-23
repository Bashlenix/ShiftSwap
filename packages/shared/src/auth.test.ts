import { describe, expect, it } from 'vitest';
import { loginSchema } from './auth';

describe('loginSchema', () => {
  it('trims and lowercases the email', () => {
    expect(
      loginSchema.parse({ email: '  Anna@ShiftSwap.test ', password: 'ShiftSwap-Demo-2026' }),
    ).toEqual({ email: 'anna@shiftswap.test', password: 'ShiftSwap-Demo-2026' });
  });
  it('rejects an invalid email with message "Enter a valid email address"', () => {
    const r = loginSchema.safeParse({ email: 'anna', password: 'ShiftSwap-Demo-2026' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({
      path: ['email'],
      message: 'Enter a valid email address',
    });
  });
  it('rejects an empty password with message "Enter your password"', () => {
    const r = loginSchema.safeParse({ email: 'anna@shiftswap.test', password: '' });
    expect(r.error!.issues[0]).toMatchObject({
      path: ['password'],
      message: 'Enter your password',
    });
  });
});
