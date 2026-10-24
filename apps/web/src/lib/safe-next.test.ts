import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it.each([
    ['/orgs/x?y=1', '/orgs/x?y=1'],
    ['/invites/abc_DEF-123', '/invites/abc_DEF-123'],
    ['/orgs', '/orgs'],
  ])('allows %s', (raw, out) => expect(safeNext(raw)).toBe(out));

  it.each([
    null,
    '',
    '//evil.example',
    '/\\evil.example',
    '\\evil.example',
    'https://evil.example',
    'orgs',
    '/redirect?to=https://evil.example',
    '/a\nb',
    '/a\tb',
    '/\u0000x',
    ' /orgs',
    'javascript:alert(1)',
  ])('falls back to /orgs for %j', (raw) => expect(safeNext(raw)).toBe('/orgs'));
});
