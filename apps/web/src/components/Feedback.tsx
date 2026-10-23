/** Error (role=alert) and success (polite live region) messages for mutations. */
export function Feedback({ error, notice }: { error: string | null; notice?: string | null }) {
  return (
    <div aria-live="polite" className="min-h-6">
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {!error && notice && <p className="text-sm text-green-800">{notice}</p>}
    </div>
  );
}
