import type { AcceptanceStatus, OfferStatus } from '@shiftswap/shared';
import { cn } from '../lib/utils';

const BADGES: Record<
  OfferStatus | AcceptanceStatus,
  { label: string; symbol: string; tone: string }
> = {
  OPEN: { label: 'Open', symbol: '●', tone: 'border-indigo-300 bg-indigo-50 text-indigo-900' },
  APPROVED: { label: 'Approved', symbol: '✓', tone: 'border-green-300 bg-green-50 text-green-900' },
  REJECTED: { label: 'Rejected', symbol: '✗', tone: 'border-red-300 bg-red-50 text-red-900' },
  FILLED: { label: 'Filled', symbol: '✓', tone: 'border-green-300 bg-green-50 text-green-900' },
  CANCELLED: {
    label: 'Cancelled',
    symbol: '–',
    tone: 'border-slate-300 bg-slate-50 text-slate-800',
  },
  EXPIRED: { label: 'Expired', symbol: '⌛', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  PENDING: {
    label: 'Pending',
    symbol: '…',
    tone: 'border-indigo-300 bg-indigo-50 text-indigo-900',
  },
  SELECTED: { label: 'Selected', symbol: '✓', tone: 'border-green-300 bg-green-50 text-green-900' },
  NOT_SELECTED: {
    label: 'Not selected',
    symbol: '–',
    tone: 'border-slate-300 bg-slate-50 text-slate-800',
  },
  WITHDRAWN: {
    label: 'Withdrawn',
    symbol: '–',
    tone: 'border-slate-300 bg-slate-50 text-slate-800',
  },
  INVALIDATED: {
    label: 'No longer eligible',
    symbol: '!',
    tone: 'border-amber-300 bg-amber-50 text-amber-900',
  },
};

/** Status as text plus a symbol; colour is only reinforcement. */
export function StatusBadge({ status }: { status: OfferStatus | AcceptanceStatus }) {
  const badge = BADGES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        badge.tone,
      )}
    >
      <span aria-hidden="true">{badge.symbol}</span>
      {badge.label}
    </span>
  );
}
