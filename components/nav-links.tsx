"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const opsSections: { label: string; items: { href: string; label: string }[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard" },
      { href: "/nada", label: "Ask Nada" },
      { href: "/reports", label: "Reports & KPIs" },
      { href: "/inbox", label: "Review Inbox" },
    ],
  },
  {
    label: "Supply Chain · MX",
    items: [
      { href: "/components", label: "Dry Goods" },
      { href: "/purchasing", label: "Purchasing" },
      { href: "/production", label: "Production" },
      { href: "/inventory", label: "Finished Goods" },
      { href: "/products", label: "Products & BOM" },
    ],
  },
  {
    label: "Market · US",
    items: [
      { href: "/partners", label: "Importer & Distributors" },
      { href: "/sales", label: "Ex-Works Sales" },
      { href: "/channel", label: "Channel Inventory" },
      { href: "/depletions", label: "Depletions" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/content", label: "Content Calendar" },
      { href: "/influencers", label: "Influencers & PR" },
    ],
  },
  {
    label: "Finance",
    items: [{ href: "/accounting", label: "Accounting" }],
  },
];

export function NavLinks({ role }: { role: string }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const sections =
    role === "BOOKKEEPER"
      ? opsSections.filter((s) => s.label === "Finance")
      : opsSections;

  const link = (item: { href: string; label: string }) => (
    <Link
      key={item.href}
      href={item.href}
      className={`block rounded-md px-2 py-1.5 text-sm ${
        isActive(item.href)
          ? "bg-agave font-medium text-cream"
          : "text-cream/70 hover:bg-white/10 hover:text-cream"
      }`}
    >
      {item.label}
    </Link>
  );

  return (
    <>
      {sections.map((section) => (
        <div key={section.label} className="pb-1">
          <div className="brand-heading px-2 pb-1 pt-3 text-[10px] font-medium tracking-widest text-blanco">
            {section.label}
          </div>
          {section.items.map(link)}
        </div>
      ))}
      <div className="pb-1">
        <div className="brand-heading px-2 pb-1 pt-3 text-[10px] font-medium tracking-widest text-blanco">
          Account
        </div>
        {link({ href: "/security", label: "My Security" })}
      </div>
      {role === "ADMIN" && (
        <>
          <div className="pb-1">
            <div className="brand-heading px-2 pb-1 pt-3 text-[10px] font-medium tracking-widest text-blanco">
              Company
            </div>
            {link({ href: "/captable", label: "Cap Table" })}
            {link({ href: "/legal", label: "Legal & IP" })}
            {link({ href: "/investor-update", label: "Investor Update" })}
          </div>
          <div className="pb-1">
            <div className="brand-heading px-2 pb-1 pt-3 text-[10px] font-medium tracking-widest text-blanco">
              Admin
            </div>
            {link({ href: "/settings", label: "Settings" })}
            {link({ href: "/nada-memory", label: "Nada's Memory" })}
          </div>
        </>
      )}
    </>
  );
}
