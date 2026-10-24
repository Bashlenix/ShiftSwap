import * as React from 'react';
import { cn } from '../../lib/utils';
import { controlClass } from './control';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn('h-11', controlClass, className)} {...props} />;
}
