import { db } from "./db";

/**
 * Cross-month aggregation over everything the team uploads or records.
 * Every import stamps rows with a YYYY-MM period (re-uploading a month
 * replaces that month), so these rollups get more complete every month:
 *  - depletions ......... importer commercial report (+ manual/CSV entries)
 *  - shipments .......... confirmed ex-works sales (cases, revenue, COGS)
 *  - channel stock ...... importer inventory reports (LSI workbook / CSV)
 *  - finance ............ logged expenses + the bookkeeper's QB P&L upload
 */

export type MonthlyKpi = {
  period: string; // YYYY-MM
  depletionCases: number; // 9L cases sold through to retail
  shipmentCases: number; // cases invoiced ex-works to the importer
  shipmentRevenueCents: number;
  cogsCents: number; // production cost of the shipped cases
  channelCases: number | null; // channel stock reported for this month
  expenseCents: number; // expenses logged in the app
  qbIncomeCents: number | null; // QuickBooks P&L, when uploaded
  qbExpenseCents: number | null;
};

export async function getMonthlyKpis(): Promise<MonthlyKpi[]> {
  const [depletions, sales, channel, expenses, financials] = await Promise.all([
    db.depletion.groupBy({ by: ["period"], _sum: { cases: true } }),
    db.exWorksSale.findMany({
      where: { status: "CONFIRMED" },
      include: { lines: { include: { product: true } } },
    }),
    db.channelStock.groupBy({ by: ["period"], _sum: { cases: true } }),
    db.expense.findMany(),
    db.financialEntry.findMany(),
  ]);

  const months = new Map<string, MonthlyKpi>();
  const at = (period: string): MonthlyKpi => {
    let m = months.get(period);
    if (!m) {
      m = {
        period,
        depletionCases: 0,
        shipmentCases: 0,
        shipmentRevenueCents: 0,
        cogsCents: 0,
        channelCases: null,
        expenseCents: 0,
        qbIncomeCents: null,
        qbExpenseCents: null,
      };
      months.set(period, m);
    }
    return m;
  };

  for (const d of depletions) at(d.period).depletionCases += d._sum.cases ?? 0;

  for (const s of sales) {
    const m = at(s.date.toISOString().slice(0, 7));
    for (const l of s.lines) {
      m.shipmentCases += l.cases;
      m.shipmentRevenueCents += l.cases * l.pricePerCaseCents;
      m.cogsCents += l.cases * l.product.caseCostCents;
    }
  }

  for (const c of channel) at(c.period).channelCases = c._sum.cases ?? 0;

  for (const e of expenses) at(e.date.toISOString().slice(0, 7)).expenseCents += e.amountCents;

  for (const f of financials) {
    // annual-only history is stored as "YYYY-FY" — it feeds the annual
    // rollup below but must not appear as a month in trends
    if (!/^\d{4}-\d{2}$/.test(f.period)) continue;
    const m = at(f.period);
    if (f.kind === "INCOME") m.qbIncomeCents = (m.qbIncomeCents ?? 0) + f.amountCents;
    else m.qbExpenseCents = (m.qbExpenseCents ?? 0) + f.amountCents;
  }

  return [...months.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * QuickBooks income/expense by calendar year, across both monthly uploads
 * ("YYYY-MM") and annual historical loads ("YYYY-FY").
 */
export async function getAnnualFinancials(): Promise<
  Map<string, { income: number; expense: number }>
> {
  const financials = await db.financialEntry.findMany();
  const byYear = new Map<string, { income: number; expense: number }>();
  for (const f of financials) {
    const year = f.period.slice(0, 4);
    if (!/^\d{4}$/.test(year)) continue;
    const y = byYear.get(year) ?? { income: 0, expense: 0 };
    if (f.kind === "INCOME") y.income += f.amountCents;
    else y.expense += f.amountCents;
    byYear.set(year, y);
  }
  return byYear;
}

/** Year-to-date depletions vs the same months last year, from the monthly rollup. */
export function ytdComparison(monthly: MonthlyKpi[], year: number) {
  const thisYear = monthly.filter((m) => m.period.startsWith(`${year}-`));
  const monthsCovered = thisYear.map((m) => m.period.slice(5));
  const lastYear = monthly.filter(
    (m) => m.period.startsWith(`${year - 1}-`) && monthsCovered.includes(m.period.slice(5))
  );
  const ytd = thisYear.reduce((a, m) => a + m.depletionCases, 0);
  const ly = lastYear.reduce((a, m) => a + m.depletionCases, 0);
  return {
    ytdCases: ytd,
    lyCases: ly,
    growthPct: ly > 0 ? ((ytd - ly) / ly) * 100 : null,
  };
}

// ---------- SKU mix (national per-SKU depletions from the report's Variants) ----------

export type SkuMix = {
  periods: string[]; // ascending
  products: { id: string; sku: string; name: string; tier: string }[];
  cases: Map<string, number>; // `${productId}|${period}` -> 9L cases
};

export async function getSkuMix(lastN = 6): Promise<SkuMix> {
  const rows = await db.skuDepletion.groupBy({
    by: ["productId", "period"],
    _sum: { cases: true },
  });
  const periods = [...new Set(rows.map((r) => r.period))].sort().slice(-lastN);
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    orderBy: { sku: "asc" },
  });
  const cases = new Map<string, number>();
  for (const r of rows) cases.set(`${r.productId}|${r.period}`, r._sum.cases ?? 0);
  return {
    periods,
    products: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, tier: p.tier })),
    cases,
  };
}

// ---------- Market + chain scoreboards (latest report, with YoY) ----------

export type MarketRow = {
  market: string;
  ytdCases: number;
  ytdCasesLY: number | null;
  growthPct: number | null;
  accounts: number;
  accountsLY: number | null;
  velocity: number | null;
};

export async function getMarketOverview(): Promise<{ asOf: string | null; rows: MarketRow[] }> {
  const latest = await db.marketSnapshot.findFirst({ orderBy: { period: "desc" } });
  if (!latest) return { asOf: null, rows: [] };
  const snaps = await db.marketSnapshot.findMany({
    where: { period: latest.period },
    orderBy: { ytdCases: "desc" },
  });
  return {
    asOf: latest.period,
    rows: snaps.map((s) => ({
      market: s.market,
      ytdCases: s.ytdCases,
      ytdCasesLY: s.ytdCasesLY,
      growthPct:
        s.ytdCasesLY && s.ytdCasesLY > 0
          ? ((s.ytdCases - s.ytdCasesLY) / s.ytdCasesLY) * 100
          : null,
      accounts: s.accounts,
      accountsLY: s.accountsLY,
      velocity: s.velocity,
    })),
  };
}

export type ChainRow = {
  chain: string;
  ytdCases: number;
  ytdCasesLY: number | null;
  growthPct: number | null;
};

export async function getChainOverview(): Promise<{ asOf: string | null; rows: ChainRow[] }> {
  const latest = await db.chainVolume.findFirst({ orderBy: { period: "desc" } });
  if (!latest) return { asOf: null, rows: [] };
  const chains = await db.chainVolume.findMany({
    where: { period: latest.period },
    orderBy: { ytdCases: "desc" },
  });
  return {
    asOf: latest.period,
    rows: chains.map((c) => ({
      chain: c.chain,
      ytdCases: c.ytdCases,
      ytdCasesLY: c.ytdCasesLY,
      growthPct:
        c.ytdCasesLY && c.ytdCasesLY > 0
          ? ((c.ytdCases - c.ytdCasesLY) / c.ytdCasesLY) * 100
          : null,
    })),
  };
}
