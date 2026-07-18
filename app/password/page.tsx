import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { btnCls, inputCls, Field } from "@/components/ui";
import { rotatePassword } from "./actions";
import { SubmitButton } from "@/components/submit-button";

/** Forced password rotation for temp/admin-set passwords. */
export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect(user.role === "BOOKKEEPER" ? "/accounting" : "/");
  const { err } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Image src="/logo-black.png" alt="Tequila De Nada" width={260} height={155} priority />
          <div className="brand-heading mt-2 text-xs tracking-[0.35em] text-agave-deep">
            Set your password
          </div>
        </div>
        <form
          action={rotatePassword}
          className="space-y-4 rounded-lg border border-ink/10 bg-white/80 p-6 shadow-sm"
        >
          <p className="text-sm text-ink/80">
            You&apos;re signed in with a temporary password. Choose your own to continue
            (at least 12 characters).
          </p>
          {err && <div className="rounded-md bg-burnt/10 px-3 py-2 text-sm text-burnt">{err}</div>}
          <Field label="Temporary password">
            <input name="current" type="password" required autoFocus className={inputCls} />
          </Field>
          <Field label="New password">
            <input name="next" type="password" required minLength={12} className={inputCls} />
          </Field>
          <Field label="Confirm new password">
            <input name="confirm" type="password" required minLength={12} className={inputCls} />
          </Field>
          <SubmitButton className="w-full">Save &amp; continue</SubmitButton>
        </form>
        <div className="brand-zigzag mx-auto mt-8 w-40" />
      </div>
    </div>
  );
}
