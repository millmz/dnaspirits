"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { NavLinks } from "./nav-links";

/**
 * Mobile app shell: sticky top bar with a hamburger that opens a slide-over
 * drawer containing the same nav as the desktop sidebar. Hidden at lg+ where
 * the fixed sidebar takes over. Closes automatically on navigation.
 */
export function MobileNav({
  role,
  name,
  email,
  logout,
}: {
  role: string;
  name: string;
  email: string;
  logout: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <header className="sticky top-0 z-40 flex items-center justify-between bg-ink px-4 py-2.5 text-cream shadow-md">
        <Link href={role === "BOOKKEEPER" ? "/accounting" : "/"}>
          <Image src="/logo-cream.png" alt="Tequila De Nada" width={100} height={60} priority />
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-ink/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-ink text-cream shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="brand-heading text-sm tracking-widest text-blanco">MENU</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-2">
              <NavLinks role={role} />
            </nav>
            <div className="border-t border-white/10 px-5 py-4">
              <div className="truncate text-sm font-medium text-cream">{name}</div>
              <div className="truncate text-xs text-cream/50">{email}</div>
              <form action={logout} className="mt-2">
                <button className="text-xs text-cream/50 underline-offset-2 hover:text-cream hover:underline">
                  Sign out
                </button>
              </form>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
