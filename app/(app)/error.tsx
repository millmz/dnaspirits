"use client";

/**
 * Error boundary for the app. Instead of the stark browser "This page couldn't
 * load", show a branded message with a retry — and surface the error digest so
 * a specific server-side failure can be found in the logs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="brand-heading text-lg text-ink">Something went wrong on this page</div>
      <p className="mt-2 max-w-md text-sm text-slate/80">
        This is usually a brief hiccup. Try again — if it keeps happening, send this reference to
        support and we can trace it in the logs.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-slate/60">ref: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-5 rounded-md bg-agave px-4 py-2 text-sm font-medium text-cream hover:bg-agave-deep"
      >
        Try again
      </button>
    </div>
  );
}
