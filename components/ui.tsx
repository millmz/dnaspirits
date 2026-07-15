import { ReactNode } from "react";

export function PageHeader({
  label,
  title,
  subtitle,
  action,
}: {
  label?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        {label && (
          <div className="brand-label mb-1 text-sm text-agave">{label}</div>
        )}
        <h1 className="brand-heading text-3xl text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-ink/10 bg-white/70 shadow-sm ${className}`}>
      {title && (
        <div className="brand-heading border-b border-ink/10 px-5 py-3 text-sm text-agave-deep">
          {title}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "agave" | "reposado" | "burnt";
}) {
  const tones = {
    ink: "text-ink",
    agave: "text-agave-deep",
    reposado: "text-reposado",
    burnt: "text-burnt",
  };
  return (
    <div className="rounded-lg border border-ink/10 bg-white/70 p-5 shadow-sm">
      <div className="brand-heading text-[11px] font-medium text-slate">{label}</div>
      <div className={`brand-heading mt-1 text-3xl ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate/80">{hint}</div>}
    </div>
  );
}

export function Table({
  headers,
  children,
  align = [],
}: {
  headers: string[];
  children: ReactNode;
  align?: ("left" | "right")[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="brand-heading border-b-2 border-ink/15 text-left text-[11px] font-medium text-slate">
            {headers.map((h, i) => (
              <th key={h + i} className={`px-3 py-2 ${align[i] === "right" ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/8">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  right = false,
  className = "",
}: {
  children: ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2.5 text-ink/90 ${right ? "text-right tabular-nums" : ""} ${className}`}>
      {children}
    </td>
  );
}

export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "gray" | "green" | "amber" | "red" | "blue" | "blanco" | "reposado" | "anejo";
}) {
  const tones: Record<string, string> = {
    gray: "bg-ink/8 text-slate",
    green: "bg-agave/15 text-agave-deep",
    amber: "bg-reposado/20 text-burnt",
    red: "bg-burnt/15 text-burnt",
    blue: "bg-blanco/25 text-agave-deep",
    blanco: "bg-blanco text-ink",
    reposado: "bg-reposado text-cream",
    anejo: "bg-ink text-cream",
  };
  return (
    <span className={`brand-heading inline-block rounded-sm px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  if (tier === "BLANCO") return <Badge tone="blanco">Blanco</Badge>;
  if (tier === "REPOSADO") return <Badge tone="reposado">Reposado</Badge>;
  if (tier === "ANEJO") return <Badge tone="anejo">Añejo</Badge>;
  return <Badge>Other</Badge>;
}

export const inputCls =
  "w-full rounded-md border border-ink/20 bg-white px-3 py-2 text-sm text-ink placeholder-slate/50 focus:border-agave focus:outline-none focus:ring-1 focus:ring-agave";

export const btnCls =
  "brand-heading inline-flex items-center justify-center rounded-md bg-agave px-4 py-2 text-sm font-medium text-cream hover:bg-agave-deep focus:outline-none focus:ring-2 focus:ring-agave focus:ring-offset-1 disabled:opacity-50";

export const btnSecondaryCls =
  "brand-heading inline-flex items-center justify-center rounded-md border border-ink/25 bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-cream";

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate">{label}</span>
      {children}
    </label>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-ink/25 px-6 py-10 text-center text-sm text-slate">
      {children}
    </div>
  );
}

export function Callout({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "red";
}) {
  const tones = {
    green: "bg-agave/10 text-agave-deep",
    amber: "bg-reposado/15 text-burnt",
    red: "bg-burnt/10 text-burnt",
  };
  return <div className={`mb-4 rounded-md px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}
