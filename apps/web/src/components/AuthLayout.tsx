import type { ReactNode } from 'react';
import { Wordmark } from './Brand';

/** Two columns from `md` up: a brand panel and the form card. Below `md`, the card only. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen md:grid md:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand p-10 text-white md:flex lg:p-14">
        <Wordmark inverted />
        <p className="relative max-w-sm text-3xl leading-tight font-semibold tracking-tight lg:text-4xl">
          Swap shifts without the group chat.
        </p>
        <div aria-hidden="true">
          <span className="absolute -top-24 -right-24 size-72 rounded-full bg-white/10" />
          <span className="absolute right-16 bottom-24 size-40 rounded-full bg-white/5" />
          <span className="absolute -bottom-20 -left-16 size-56 rounded-full bg-brand-strong/60" />
        </div>
      </div>
      <div className="flex min-h-screen items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </main>
  );
}
