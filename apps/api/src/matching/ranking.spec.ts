import { rankByScore, scoreCandidate } from './ranking';

describe('scoreCandidate', () => {
  const base = { preference: 'NEUTRAL' as const, weeklyMinutesAfter: 720, weeklyLimitMin: 2400, swapsLast30Days: 1 };

  it('scores the reference example', () => {
    expect(scoreCandidate(base)).toEqual({ total: 63, breakdown: { preference: 20, headroom: 28, swapLoad: 15 } });
  });
  it('maps preference to 40/20/0', () => {
    expect(scoreCandidate({ ...base, preference: 'PREFERRED' }).breakdown.preference).toBe(40);
    expect(scoreCandidate({ ...base, preference: 'AVOID' }).breakdown.preference).toBe(0);
  });
  it('clamps headroom to 0..40', () => {
    expect(scoreCandidate({ ...base, weeklyMinutesAfter: 3000 }).breakdown.headroom).toBe(0);
    expect(scoreCandidate({ ...base, weeklyMinutesAfter: 0 }).breakdown.headroom).toBe(40);
  });
  it('swap load reaches 0 at 5 swaps and stays there', () => {
    expect(scoreCandidate({ ...base, swapsLast30Days: 5 }).breakdown.swapLoad).toBe(0);
    expect(scoreCandidate({ ...base, swapsLast30Days: 9 }).breakdown.swapLoad).toBe(0);
  });
});

describe('rankByScore', () => {
  const d = (n: number) => new Date(2026, 9, n);
  it('orders by total desc, then earlier createdAt, nulls last', () => {
    const items = [
      { id: 'null', createdAt: d(1), score: null },
      { id: 'low', createdAt: d(1), score: { total: 10 } },
      { id: 'tieLate', createdAt: d(3), score: { total: 50 } },
      { id: 'tieEarly', createdAt: d(2), score: { total: 50 } },
    ];
    expect(rankByScore(items).map((i) => i.id)).toEqual(['tieEarly', 'tieLate', 'low', 'null']);
  });
  it('does not mutate input', () => {
    const items = [
      { createdAt: d(1), score: { total: 1 } },
      { createdAt: d(2), score: { total: 2 } },
    ];
    const copy = [...items];
    rankByScore(items);
    expect(items).toEqual(copy);
  });
});
