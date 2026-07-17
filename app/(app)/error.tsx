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
  // A missing digest almost always means a client-side/chunk error — most
  // often "version skew" from a tab left open across a deploy. A full reload
  // (not just reset()) pulls the current build and clears it. Try to recover
  // automatically, once, so the user rarely even sees this screen.
  const isLikelyVersionSkew = !error.digest;
  const reload = () => window.location.reload();

  if (typeof window !== "undefined" && isLikelyVersionSkew) {
    const KEY = "denada-reloaded-at";
    const last = Number(sessionStorage.getItem(KEY) || 0);
    // guard against a reload loop: only auto-reload if we haven't in the last 10s
    if (Date.now() - last > 10_000) {
      sessionStorage.setItem(KEY, String(Date.now()));
      reload();
    }
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="brand-heading text-lg text-ink">Something went wrong on this page</div>
      <p className="mt-2 max-w-md text-sm text-slate/80">
        This is usually a brief hiccup after an update. Reload to get the latest version — if it keeps
        happening, send the reference below to support and we can trace it in the logs.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-slate/60">ref: {error.digest}</p>
      )}
      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={reload}
          className="rounded-md bg-agave px-4 py-2 text-sm font-medium text-cream hover:bg-agave-deep"
        >
          Reload the page
        </button>
        <button onClick={reset} className="text-sm text-slate underline-offset-2 hover:underline">
          Try again without reloading
        </button>
      </div>
    </div>
  );
}
