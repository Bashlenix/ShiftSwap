import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** The page's `h1`, with an optional description and actions on the right. */
export function PageHeader({
  title,
  id,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  id?: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 id={id} className="text-2xl font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        {description && <p className="max-w-prose text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
