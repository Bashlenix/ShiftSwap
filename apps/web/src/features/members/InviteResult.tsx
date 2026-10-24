import { useState } from 'react';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';

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
      className="flex flex-col gap-2 rounded-md border border-green-300 bg-green-50 p-3"
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
          className="text-sm text-indigo-800 underline"
        >
          Open demo inbox
        </a>
      </div>
      <input
        readOnly
        aria-label="Invite link"
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className="h-9 w-full rounded-md border border-slate-400 bg-white px-2 text-xs"
      />
      <Feedback error={error} notice={copied} />
    </section>
  );
}
