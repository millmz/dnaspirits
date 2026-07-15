"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md bg-agave px-4 py-2 text-sm font-medium text-cream hover:bg-agave-deep print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
