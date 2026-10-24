import { useState } from 'react';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { controlClass } from '../../components/ui/control';
import { cn } from '../../lib/utils';

/** Shown after an invite is created or re-sent; the link is also the manual fallback. */
export function InviteResult({
  email,
  link,
  containerRef,
}: {
  email: string;
  link: string;
  containerRef?: React.Ref<HTMLParagraphElement>;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(link);
      setCopied('Link copied.');
    } catch {
      setCopied(null);
      setError('Could not copy the link. Select it below and copy it manually.');
    }
  }

  return (
    <section
      aria-label="Invite"
      className="flex flex-col gap-2 rounded-card border border-emerald-200 bg-emerald-50 p-4"
    >
      <p ref={containerRef} tabIndex={-1} className="text-sm font-medium outline-none">
        Invite sent to {email}.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          Copy invite link
        </Button>
        <a
          href="/mailpit/"
          target="_blank"
          rel="noopener"
          className="text-sm font-medium text-brand-strong underline"
        >
          Open demo inbox
        </a>
      </div>
      <input
        readOnly
        aria-label="Invite link"
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className={cn(controlClass, 'h-9 px-2 text-xs')}
      />
      <Feedback error={error} notice={copied} />
    </section>
  );
}
