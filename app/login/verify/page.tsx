import Image from "next/image";
import { redirect } from "next/navigation";
import { readPreAuth } from "@/lib/auth";
import { btnCls, inputCls, Field } from "@/components/ui";
import { verifyLoginCode } from "../actions";

/** Second sign-in step for accounts with two-factor authentication. */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const pending = await readPreAuth();
  if (!pending) redirect("/login");
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Image src="/logo-black.png" alt="Tequila De Nada" width={260} height={155} priority />
          <div className="brand-heading mt-2 text-xs tracking-[0.35em] text-agave-deep">
            Two-Factor Check
          </div>
        </div>
        <form
          action={verifyLoginCode}
          className="space-y-4 rounded-lg border border-ink/10 bg-white/80 p-6 shadow-sm"
        >
          {error && (
            <div className="rounded-md bg-burnt/10 px-3 py-2 text-sm text-burnt">
              {error === "locked"
                ? "Too many attempts — wait 15 minutes and try again."
                : "That code didn't match. Enter the current code from your authenticator app."}
            </div>
          )}
          <Field label="6-digit code from your authenticator app">
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              placeholder="123456"
              className={`${inputCls} text-center text-lg tracking-[0.4em]`}
            />
          </Field>
          <button type="submit" className={`${btnCls} w-full`}>
            Verify
          </button>
          <p className="text-center text-xs text-slate/70">
            Lost your phone? An admin can reset 2FA for your account from Settings.
          </p>
        </form>
        <div className="brand-zigzag mx-auto mt-8 w-40" />
      </div>
    </div>
  );
}
