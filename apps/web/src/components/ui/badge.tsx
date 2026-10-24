import * as React from 'react';
import { cn } from '../../lib/utils';

// Text/background pairs are all ≥ 7:1; the border is decorative (the text carries the meaning).
const TONES = {
  neutral: 'border-slate-300 bg-slate-100 text-slate-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-800',
  brand: 'border-indigo-200 bg-indigo-50 text-brand-strong',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
