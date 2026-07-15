import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { NavLinks } from "@/components/nav-links";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-56 flex-col bg-stone-900 text-stone-300">
        <Link href="/" className="block px-5 pb-4 pt-6">
          <div className="text-xl font-bold tracking-tight text-white">DENADA</div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-stone-400">
            Tequila · Ops
          </div>
        </Link>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          <NavLinks isAdmin={user.role === "ADMIN"} />
        </nav>
        <div className="border-t border-stone-800 px-5 py-4">
          <div className="truncate text-sm font-medium text-white">{user.name}</div>
          <div className="truncate text-xs text-stone-400">{user.email}</div>
          <form action={logout} className="mt-2">
            <button className="text-xs text-stone-400 underline-offset-2 hover:text-white hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="ml-56 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
