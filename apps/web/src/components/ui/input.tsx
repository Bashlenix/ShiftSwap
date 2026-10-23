import * as React from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-slate-400 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 aria-[invalid=true]:border-red-700',
        className,
      )}
      {...props}
    />
  );
}
