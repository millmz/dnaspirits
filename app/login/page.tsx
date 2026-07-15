import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { btnCls, inputCls, Field } from "@/components/ui";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "BOOKKEEPER" ? "/accounting" : "/");
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Image
            src="/logo-black.png"
            alt="Tequila De Nada"
            width={260}
            height={155}
            priority
          />
          <div className="brand-heading mt-2 text-xs tracking-[0.35em] text-agave-deep">
            Operations
          </div>
        </div>
        <form
          action={login}
          className="space-y-4 rounded-lg border border-ink/10 bg-white/80 p-6 shadow-sm"
        >
          {error && (
            <div className="rounded-md bg-burnt/10 px-3 py-2 text-sm text-burnt">
              {error === "locked"
                ? "Too many attempts — wait 15 minutes and try again."
                : "Invalid email or password."}
            </div>
          )}
          <Field label="Email">
            <input name="email" type="email" required autoFocus className={inputCls} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" required className={inputCls} />
          </Field>
          <button type="submit" className={`${btnCls} w-full`}>
            Sign in
          </button>
        </form>
        <div className="brand-zigzag mx-auto mt-8 w-40" />
      </div>
    </div>
  );
}
