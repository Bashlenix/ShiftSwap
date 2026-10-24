import { ArrowLeftRight } from 'lucide-react';
import { cn } from '../lib/utils';

/** The "ShiftSwap" wordmark. `inverted` is for use on the brand colour. */
export function Wordmark({
  inverted = false,
  className,
}: {
  inverted?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-lg font-semibold', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'grid size-8 place-items-center rounded-lg',
          inverted ? 'bg-white text-brand' : 'bg-brand text-white',
        )}
      >
        <ArrowLeftRight className="size-4" />
      </span>
      ShiftSwap
    </span>
  );
}
