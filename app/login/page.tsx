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
  if (user) redirect("/");
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold tracking-tight text-emerald-800">
            DENADA
          </div>
          <div className="mt-1 text-sm uppercase tracking-[0.3em] text-stone-500">
            Tequila · Operations
          </div>
        </div>
        <form
          action={login}
          className="space-y-4 rounded-xl border border-stone-200 bg-white p-6 shadow-sm"
        >
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Invalid email or password.
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
      </div>
    </div>
  );
}
