import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demo-data';

describe('DEMO_ACCOUNTS.md', () => {
  const doc = readFileSync(join(__dirname, '../../../../DEMO_ACCOUNTS.md'), 'utf8');

  it('lists every demo email', () => {
    for (const account of DEMO_ACCOUNTS) expect(doc).toContain(account.email);
  });

  it('states the demo password', () => {
    expect(doc).toContain(DEMO_PASSWORD);
  });
});
