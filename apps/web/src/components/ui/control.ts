/**
 * Shared look for native form controls (input, select, textarea).
 * The border uses the `control` token (slate-500, 4.8:1 on white) to meet WCAG 1.4.11.
 */
export const controlClass =
  'w-full rounded-lg border border-control bg-surface px-3 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand aria-[invalid=true]:border-danger disabled:bg-slate-100';
