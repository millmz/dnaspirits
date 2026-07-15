"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard" }],
  },
  {
    label: "Supply Chain",
    items: [
      { href: "/inventory", label: "Inventory" },
      { href: "/production", label: "Production Runs" },
      { href: "/products", label: "Products" },
    ],
  },
  {
    label: "Distribution",
    items: [
      { href: "/distributors", label: "Distributors" },
      { href: "/shipments", label: "Shipments" },
      { href: "/depletions", label: "Depletions" },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/accounting", label: "Accounting" },
      { href: "/marketing", label: "Marketing" },
    ],
  },
];

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {sections.map((section) => (
        <div key={section.label} className="pb-2">
          <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            {section.label}
          </div>
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-lg px-2 py-1.5 text-sm ${
                isActive(item.href)
                  ? "bg-emerald-800/60 font-medium text-white"
                  : "hover:bg-stone-800 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
      {isAdmin && (
        <div className="pb-2">
          <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            Admin
          </div>
          <Link
            href="/settings"
            className={`block rounded-lg px-2 py-1.5 text-sm ${
              isActive("/settings")
                ? "bg-emerald-800/60 font-medium text-white"
                : "hover:bg-stone-800 hover:text-white"
            }`}
          >
            Settings
          </Link>
        </div>
      )}
    </>
  );
}
