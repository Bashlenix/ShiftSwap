import * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * A card-styled table; wide tables scroll inside their own container, never the page.
 * `relative` keeps absolutely positioned children (e.g. `sr-only` text) inside that container.
 */
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="relative overflow-x-auto rounded-card border border-slate-200 bg-surface shadow-soft">
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...props} />
    </div>
  );
}

export function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      className={cn('border-b border-slate-200 px-4 py-3 text-left font-medium', className)}
      {...props}
    />
  );
}

export function THead({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('bg-slate-50 text-slate-700', className)} {...props} />;
}

export function TR({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr className={cn('border-b border-slate-200 last:border-b-0', className)} {...props} />;
}

/** Column header by default; pass `scope="row"` for a row header. */
export function TH({ className, scope = 'col', ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      scope={scope}
      className={cn(
        'px-3 py-2.5 align-middle',
        scope === 'row' ? 'font-medium text-slate-900' : 'text-sm font-semibold',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-2.5 align-middle', className)} {...props} />;
}
