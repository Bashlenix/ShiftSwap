import { describe, expect, it } from 'vitest';

describe('localToInstant', () => {
  it('converts winter and summer wall time', async () => {
    const { localToInstant } = await import('./format');
    expect(localToInstant('2026-11-10T09:00', 'Europe/Berlin')).toBe('2026-11-10T08:00:00.000Z');
    expect(localToInstant('2026-10-24T09:00', 'Europe/Berlin')).toBe('2026-10-24T07:00:00.000Z');
    expect(localToInstant('2026-10-26T09:00', 'Europe/Berlin')).toBe('2026-10-26T08:00:00.000Z');
  });
});

describe('formatDateTime', () => {
  it('formats an instant in the given zone', async () => {
    const { formatDateTime } = await import('./format');
    expect(formatDateTime('2026-10-24T12:05:00Z', 'Europe/Berlin')).toBe('Sat 24 Oct, 14:05');
  });
});
