import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getMonthlyKpis } from "@/lib/kpi";
import { getOpenReceivables } from "@/lib/receivables";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { money, num } from "@/lib/format";
import { BarChart } from "@/components/charts";
import { PrintButton } from "@/components/print-button";

async function saveCommentary(formData: FormData) {
  "use server";
  await requireAdmin();
  const month = String(formData.get("month"));
  await setSetting(`investor-note-${month}`, String(formData.get("note") ?? "").slice(0, 4000));
  redirect(`/investor-update?month=${month}`);
}

/**
 * One-click monthly investor update: KPIs, trend chart and commentary,
 * print-ready. Pulls from the same data the rest of the platform uses.
 */
export default async function InvestorUpdatePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireAdmin();
  const { month } = await searchParams;
  const current = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : new Date().toISOString().slice(0, 7);

  const [kpis, ar, followers, note] = await Promise.all([
    getMonthlyKpis(),
    getOpenReceivables(),
    db.accountMetric.findFirst({ where: { platform: "INSTAGRAM" }, orderBy: { fetchedAt: "desc" } }),
    getSetting(`investor-note-${current}`),
  ]);

  const idx = kpis.findIndex((k) => k.period === current);
  const thisMonth = idx >= 0 ? kpis[idx] : null;
  const last12 = kpis.filter((k) => k.period <= current).slice(-12);
  const prevYear = kpis.find((k) => k.period === `${Number(current.slice(0, 4)) - 1}${current.slice(4)}`);
  const monthName = new Date(`${current}-15`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const yoy =
    thisMonth && prevYear && prevYear.depletionCases > 0
      ? Math.round(((thisMonth.depletionCases - prevYear.depletionCases) / prevYear.depletionCases) * 100)
      : null;

  const months = kpis.map((k) => k.period).slice(-18).reverse();

  return (
    <div className="min-h-screen bg-cream px-6 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href="/" className="brand-heading text-sm text-agave hover:underline">← Dashboard</Link>
          <div className="flex items-center gap-2">
            <form method="get" className="flex items-center gap-2">
              <select name="month" defaultValue={current} className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm">
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm hover:border-agave">Load</button>
            </form>
            <PrintButton />
          </div>
        </div>

        <div className="rounded-lg border border-ink/10 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
          <div className="flex items-start justify-between">
            <Image src="/logo-black.png" alt="Tequila De Nada" width={150} height={89} />
            <div className="text-right">
              <div className="brand-heading text-lg text-ink">Investor Update</div>
              <div className="text-sm text-slate/80">{monthName}</div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Depletions (9L cases)", thisMonth ? num(thisMonth.depletionCases) : "—"],
              ["Cases shipped", thisMonth ? num(thisMonth.shipmentCases) : "—"],
              ["Net revenue", thisMonth ? money(thisMonth.shipmentRevenueCents - thisMonth.chargebackCents) : "—"],
              ["YoY depletions", yoy === null ? "—" : `${yoy > 0 ? "+" : ""}${yoy}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-ink/10 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate/60">{label}</div>
                <div className="brand-heading mt-1 text-xl text-ink">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <div className="brand-heading mb-2 text-xs tracking-widest text-slate">Depletions — trailing 12 months (9L cases)</div>
            <BarChart
              groups={last12.map((k) => k.period.slice(2))}
              series={[{ label: "9L cases", color: "#018769", values: last12.map((k) => Math.round(k.depletionCases)) }]}
            />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="brand-heading text-[10px] tracking-widest text-slate">Receivables</div>
              <div className="mt-1">{money(ar.totalNetCents)} open{ar.aging.d90plus > 0 ? ` · ${money(ar.aging.d90plus)} at 90+ days` : ""}</div>
            </div>
            <div>
              <div className="brand-heading text-[10px] tracking-widest text-slate">Community</div>
              <div className="mt-1">{followers ? `${num(followers.followers)} Instagram followers` : "—"}</div>
            </div>
          </div>

          <div className="mt-6">
            <div className="brand-heading mb-1 text-[10px] tracking-widest text-slate">Founders&apos; notes</div>
            {note ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{note}</p>
            ) : (
              <p className="text-sm text-slate/50 print:hidden">No commentary yet — add it below.</p>
            )}
          </div>

          <p className="mt-8 text-center text-xs text-slate/60">Tequila De Nada · DNA Spirits LLC · de nada.</p>
        </div>

        <form action={saveCommentary} className="mt-4 print:hidden">
          <input type="hidden" name="month" value={current} />
          <textarea
            name="note"
            rows={4}
            defaultValue={note}
            placeholder="What happened this month — wins, launches, what's next…"
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm"
          />
          <button className="mt-2 rounded-md bg-agave px-4 py-2 text-sm font-medium text-cream hover:bg-agave-deep">
            Save commentary
          </button>
        </form>
      </div>
    </div>
  );
}
