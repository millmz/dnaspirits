import Link from "next/link";
import Image from "next/image";
import { requireUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { NavLinks } from "@/components/nav-links";
import { MobileNav } from "@/components/mobile-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="min-h-screen lg:flex">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col bg-ink text-cream lg:flex">
        <Link href={user.role === "BOOKKEEPER" ? "/accounting" : "/"} className="block px-6 pb-2 pt-6">
          <Image
            src="/logo-cream.png"
            alt="Tequila De Nada"
            width={168}
            height={100}
            priority
          />
        </Link>
        <div className="brand-zigzag mx-6 mb-1" />
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          <NavLinks role={user.role} />
        </nav>
        <div className="border-t border-white/10 px-6 py-4">
          <div className="truncate text-sm font-medium text-cream">{user.name}</div>
          <div className="truncate text-xs text-cream/50">{user.email}</div>
          <form action={logout} className="mt-2">
            <button className="text-xs text-cream/50 underline-offset-2 hover:text-cream hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* mobile top bar + drawer */}
      <MobileNav role={user.role} name={user.name} email={user.email} logout={logout} />

      <main className="flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:ml-60 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
