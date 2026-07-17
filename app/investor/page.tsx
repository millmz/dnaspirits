import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMonthlyKpis, getAnnualFinancials, ytdComparison, getMarketOverview, getChainOverview } from "@/lib/kpi";
import { getMarketPosition } from "@/lib/market";
import { money, num } from "@/lib/format";
import { BarChart } from "@/components/charts";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

/**
 * One-page investor update, assembled live from the data already in the
 * platform. Admin-only; print to PDF from the browser. Deliberately outside
 * the app shell so the printed page is clean.
 */
export default async function InvestorPage() {
  await requireAdmin();

  const [monthly, annualFin, markets, chains, position, capital] = await Promise.all([
    getMonthlyKpis(),
    getAnnualFinancials(),
    getMarketOverview(),
    getChainOverview(),
    getMarketPosition(),
    db.capTableEntry.aggregate({ _sum: { capitalCents: true } }),
  ]);

  const now = new Date();
  const year = now.getFullYear();
  const ytd = ytdComparison(monthly, year);
  const last12 = monthly.slice(-12);

  const withDepletions = monthly.filter((m) => m.depletionCases > 0).slice(-3);
  const velocity =
    withDepletions.length > 0
      ? withDepletions.reduce((a, m) => a + m.depletionCases, 0) / withDepletions.length
      : 0;
  const channelTotal = position.reduce((a, p) => a + p.channelCases, 0);
  const weeks = velocity > 0 ? Math.round((channelTotal / velocity) * 4.33) : null;
  const accounts = markets.rows.reduce((a, r) => a + r.accounts, 0);

  const years = [...annualFin.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4);

  const stat = (label: string, value: string, hint?: string) => (
    <div className="rounded-md border border-ink/15 p-3">
      <div className="brand-heading text-[10px] font-medium tracking-widest text-slate">{label}</div>
      <div className="brand-heading mt-0.5 text-xl text-ink">{value}</div>
      {hint && <div className="text-[11px] text-slate/80">{hint}</div>}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl bg-cream px-8 py-8 print:max-w-none print:bg-white print:px-0 print:py-0">
      <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
        <Link href="/reports" className="text-sm text-agave-deep underline">← Back to Reports</Link>
        <PrintButton />
      </div>

      <header className="flex items-end justify-between border-b-2 border-ink pb-4">
        <div>
          <Image src="/logo-black.png" alt="De Nada Tequila" width={150} height={54} />
          <div className="brand-heading mt-2 text-2xl tracking-wide text-ink">INVESTOR UPDATE</div>
        </div>
        <div className="text-right text-sm text-slate">
          <div className="font-medium text-ink">DNA Spirits LLC</div>
          <div>{now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</div>
          <div className="text-xs">Confidential — prepared for members &amp; investors</div>
        </div>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat(
          `Depletions · ${year} YTD`,
          `${num(Math.round(ytd.ytdCases))} cases`,
          ytd.growthPct === null ? "9L cases to retail" : `${ytd.growthPct >= 0 ? "+" : ""}${num(Math.round(ytd.growthPct))}% vs last year`
        )}
        {stat("Velocity", `${num(Math.round(velocity * 10) / 10)}/mo`, "3-month average")}
        {stat("Channel supply", weeks === null ? "—" : `${weeks} weeks`, `${num(Math.round(channelTotal))} cases in market`)}
        {stat("Retail accounts", num(accounts), markets.asOf ? `across ${markets.rows.length} states (as of ${markets.asOf})` : "")}
      </section>

      <section className="mt-6">
        <div className="brand-heading mb-2 text-xs font-medium tracking-widest text-slate">
          SHIPMENTS IN VS DEPLETIONS OUT · LAST 12 MONTHS · 9L CASES
        </div>
        <BarChart
          groups={last12.map((m) => m.period)}
          series={[
            { label: "9L cases shipped", color: "#231F20", values: last12.map((m) => Math.round(m.shipment9lCases * 10) / 10) },
            { label: "9L cases depleted", color: "#018769", values: last12.map((m) => m.depletionCases) },
          ]}
          height={160}
        />
      </section>

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <div className="brand-heading mb-2 text-xs font-medium tracking-widest text-slate">FINANCIAL HISTORY</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/20 text-left text-[11px] text-slate">
                <th className="py-1">Year</th>
                <th className="py-1 text-right">Revenue</th>
                <th className="py-1 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {years.map(([y, f]) => (
                <tr key={y} className="border-b border-ink/8">
                  <td className="py-1 font-medium">{y}</td>
                  <td className="py-1 text-right">{money(f.income)}</td>
                  <td className={`py-1 text-right ${f.income - f.expense < 0 ? "text-burnt" : "text-agave-deep"}`}>
                    {money(f.income - f.expense)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[11px] text-slate/80">
            Capital raised to date: {money(capital._sum.capitalCents ?? 0)}. Current year figures are YTD as uploaded.
          </div>
        </div>

        <div>
          <div className="brand-heading mb-2 text-xs font-medium tracking-widest text-slate">
            TOP MARKETS — YTD{markets.asOf ? ` (${markets.asOf})` : ""}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/20 text-left text-[11px] text-slate">
                <th className="py-1">Market</th>
                <th className="py-1 text-right">Cases</th>
                <th className="py-1 text-right">Growth</th>
                <th className="py-1 text-right">Accounts</th>
              </tr>
            </thead>
            <tbody>
              {markets.rows.slice(0, 6).map((r) => (
                <tr key={r.market} className="border-b border-ink/8">
                  <td className="py-1 font-medium">{r.market}</td>
                  <td className="py-1 text-right">{num(Math.round(r.ytdCases))}</td>
                  <td className={`py-1 text-right ${r.growthPct !== null && r.growthPct < 0 ? "text-burnt" : "text-agave-deep"}`}>
                    {r.growthPct === null ? "new" : `${r.growthPct >= 0 ? "+" : ""}${num(Math.round(r.growthPct))}%`}
                  </td>
                  <td className="py-1 text-right">{num(r.accounts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {chains.rows.length > 0 && (
        <section className="mt-6">
          <div className="brand-heading mb-2 text-xs font-medium tracking-widest text-slate">
            KEY RETAIL CHAINS — YTD CASES
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {chains.rows.slice(0, 8).map((c) => (
              <span key={c.chain} className="rounded-md border border-ink/15 px-2 py-1">
                {c.chain} · {num(Math.round(c.ytdCases))}
              </span>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-8 border-t border-ink/20 pt-3 text-[10px] text-slate/70">
        Prepared from DNA Spirits LLC operating data (importer depletion reports, channel inventory and
        QuickBooks financials). Confidential — not for distribution. De Nada Tequila® · Los Altos, Jalisco.
      </footer>
    </div>
  );
}
