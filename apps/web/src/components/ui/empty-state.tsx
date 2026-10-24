import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** A friendly placeholder for an empty list; `title` is the message itself. */
export function EmptyState({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-card border border-dashed border-slate-300 bg-surface px-6 py-10 text-center',
        className,
      )}
    >
      {Icon && (
        <span className="grid size-10 place-items-center rounded-full bg-slate-100 text-muted">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      )}
      <p className="font-medium text-slate-800">{title}</p>
      {children}
    </div>
  );
}
