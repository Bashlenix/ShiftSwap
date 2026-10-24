import type { AcceptanceStatus, OfferStatus } from '@shiftswap/shared';
import { Badge, type BadgeTone } from './ui/badge';

const BADGES: Record<
  OfferStatus | AcceptanceStatus,
  { label: string; symbol: string; tone: BadgeTone }
> = {
  OPEN: { label: 'Open', symbol: '●', tone: 'brand' },
  APPROVED: { label: 'Approved', symbol: '✓', tone: 'success' },
  REJECTED: { label: 'Rejected', symbol: '✗', tone: 'danger' },
  FILLED: { label: 'Filled', symbol: '✓', tone: 'success' },
  CANCELLED: { label: 'Cancelled', symbol: '–', tone: 'neutral' },
  EXPIRED: { label: 'Expired', symbol: '⌛', tone: 'warning' },
  PENDING: { label: 'Pending', symbol: '…', tone: 'brand' },
  SELECTED: { label: 'Selected', symbol: '✓', tone: 'success' },
  NOT_SELECTED: { label: 'Not selected', symbol: '–', tone: 'neutral' },
  WITHDRAWN: { label: 'Withdrawn', symbol: '–', tone: 'neutral' },
  INVALIDATED: { label: 'No longer eligible', symbol: '!', tone: 'warning' },
};

/** Status as text plus a symbol; colour is only reinforcement. */
export function StatusBadge({ status }: { status: OfferStatus | AcceptanceStatus }) {
  const badge = BADGES[status];
  return (
    <Badge tone={badge.tone}>
      <span aria-hidden="true">{badge.symbol}</span>
      {badge.label}
    </Badge>
  );
}
