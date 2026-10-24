import { DomainError } from './domain-error';
import { parseLimit, singleQueryParam } from './query-params';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : 'OTHER';
  }
  return 'NONE';
};

describe('singleQueryParam', () => {
  it('passes a single string or undefined through', () => {
    expect(singleQueryParam('a', 'x')).toBe('a');
    expect(singleQueryParam(undefined, 'x')).toBeUndefined();
  });
  it('rejects repeated (array) or object values with VALIDATION_FAILED', () => {
    expect(code(() => singleQueryParam(['1', '2'], 'limit'))).toBe('VALIDATION_FAILED');
    expect(code(() => singleQueryParam({ a: '1' }, 'limit'))).toBe('VALIDATION_FAILED');
  });
});

describe('parseLimit', () => {
  const opts = { defaultLimit: 20, max: 50 };
  it('defaults when absent and accepts 1..max digits', () => {
    expect(parseLimit(undefined, opts)).toBe(20);
    expect(parseLimit('1', opts)).toBe(1);
    expect(parseLimit('50', opts)).toBe(50);
    expect(parseLimit('007', opts)).toBe(7);
  });
  it.each(['0', '51', 'abc', '', '1e1', '2.0', ' 5', '-1', '+5', '0x10'])('rejects %j', (raw) => {
    expect(code(() => parseLimit(raw, opts))).toBe('VALIDATION_FAILED');
  });
  it('rejects repeated values', () => {
    expect(code(() => parseLimit(['1', '2'], opts))).toBe('VALIDATION_FAILED');
  });
});
