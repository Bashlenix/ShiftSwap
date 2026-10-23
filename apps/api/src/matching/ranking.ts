export type Preference = 'PREFERRED' | 'NEUTRAL' | 'AVOID';

const PREFERENCE_POINTS: Record<Preference, number> = { PREFERRED: 40, NEUTRAL: 20, AVOID: 0 };
const HEADROOM_MAX = 40;
const SWAP_LOAD_MAX = 20;
const SWAP_LOAD_PENALTY = 5;

export interface ScoreInput {
  preference: Preference;
  weeklyMinutesAfter: number;
  weeklyLimitMin: number;
  swapsLast30Days: number;
}

export interface ScoreResult {
  total: number;
  breakdown: { preference: number; headroom: number; swapLoad: number };
}

export function scoreCandidate(input: ScoreInput): ScoreResult {
  const preference = PREFERENCE_POINTS[input.preference];
  const ratio = input.weeklyLimitMin > 0 ? input.weeklyMinutesAfter / input.weeklyLimitMin : 1;
  const headroom = Math.min(HEADROOM_MAX, Math.max(0, Math.round(HEADROOM_MAX * (1 - ratio))));
  const swapLoad = Math.max(0, SWAP_LOAD_MAX - SWAP_LOAD_PENALTY * input.swapsLast30Days);
  return { total: preference + headroom + swapLoad, breakdown: { preference, headroom, swapLoad } };
}

/** Score desc, null scores last, ties by earlier createdAt. Returns a new array. */
export function rankByScore<T extends { createdAt: Date; score: { total: number } | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.score === null && b.score !== null) return 1;
    if (a.score !== null && b.score === null) return -1;
    if (a.score && b.score && a.score.total !== b.score.total) return b.score.total - a.score.total;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
