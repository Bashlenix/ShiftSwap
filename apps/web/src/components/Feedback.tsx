import type { Ref } from 'react';
import { cn } from '../lib/utils';

/**
 * Error (role=alert) and success (polite live region) messages for mutations.
 * The container is always mounted so screen readers announce content changes;
 * `containerRef` lets a page move focus here after a dialog closes.
 * `collapse` (in a `gap-4` column): while empty the region takes no space and cancels the gap
 * above it, instead of reserving a line; it stays mounted either way.
 */
export function Feedback({
  error,
  notice,
  containerRef,
  collapse = false,
}: {
  error: string | null;
  notice?: string | null;
  containerRef?: Ref<HTMLDivElement>;
  collapse?: boolean;
}) {
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      aria-live="polite"
      className={cn('outline-none', collapse ? 'empty:-mt-4' : 'min-h-6')}
    >
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {!error && notice && <p className="text-sm text-success">{notice}</p>}
    </div>
  );
}
