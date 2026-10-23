import type { Ref } from 'react';

/**
 * Error (role=alert) and success (polite live region) messages for mutations.
 * The container is always mounted so screen readers announce content changes;
 * `containerRef` lets a page move focus here after a dialog closes.
 */
export function Feedback({
  error,
  notice,
  containerRef,
}: {
  error: string | null;
  notice?: string | null;
  containerRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={containerRef} tabIndex={-1} aria-live="polite" className="min-h-6 outline-none">
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {!error && notice && <p className="text-sm text-green-800">{notice}</p>}
    </div>
  );
}
