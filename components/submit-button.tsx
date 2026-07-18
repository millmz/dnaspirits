"use client";

import { useFormStatus } from "react-dom";
import { btnCls, btnSecondaryCls } from "@/components/ui";

/**
 * Form submit button with instant feedback: the moment it's clicked it
 * disables and shows a spinner until the server action finishes — no more
 * "did that do anything?" moments.
 */
export function SubmitButton({
  children,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const { pending } = useFormStatus();
  const base = variant === "secondary" ? btnSecondaryCls : btnCls;
  return (
    <button type="submit" disabled={pending} className={`${base} ${className} disabled:cursor-wait`}>
      {pending && (
        <svg className="mr-2 h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      {children}
    </button>
  );
}
