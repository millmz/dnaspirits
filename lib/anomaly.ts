import { db } from "./db";
import type { CommercialReport } from "./commercial-report";
import type { LsiInventoryReport } from "./lsi-inventory";
import { num } from "./format";

/**
 * Deterministic anomaly detection over a parsed report vs. the history already
 * in the database. These are the hard signals — the kind of thing that should
 * never slip past review (a market that fell off a cliff, a distributor that
 * went dark, a suspiciously large restatement). The optional Claude layer adds
 * narrative on top; these flags stand on their own with no API key.
 */

/** Compares each market's newest-month depletions in the report to its trailing average. */
export async function analyzeCommercialReport(report: CommercialReport): Promise<string[]> {
  const flags: string[] = [];
  const period = report.reportPeriod;

  // newest-month depletions per market from the report
  const latestByMarket = new Map<string, number>();
  for (const d of report.depletions.filter((d) => d.period === period)) {
    latestByMarket.set(d.market, (latestByMarket.get(d.market) ?? 0) + d.cases);
  }

  // trailing average (prior 3 report months) per market, from the DB
  const priorPeriods = [...new Set(report.depletions.map((d) => d.period))]
    .filter((p) => p < period)
    .sort()
    .slice(-3);
  if (priorPeriods.length > 0) {
    const existing = await db.depletion.findMany({
      where: { source: "REPORT", period: { in: priorPeriods } },
      include: { distributor: true },
    });
    const trailing = new Map<string, number[]>();
    const byMarketPeriod = new Map<string, number>();
    for (const d of existing) {
      const market = d.distributor.market || d.distributor.name;
      const key = `${market}|${d.period}`;
      byMarketPeriod.set(key, (byMarketPeriod.get(key) ?? 0) + d.cases);
    }
    for (const [key, cases] of byMarketPeriod) {
      const market = key.split("|")[0];
      const arr = trailing.get(market) ?? [];
      arr.push(cases);
      trailing.set(market, arr);
    }
    for (const [market, latest] of latestByMarket) {
      const arr = trailing.get(market);
      if (!arr || arr.length === 0) continue;
      const avg = arr.reduce((a, c) => a + c, 0) / arr.length;
      if (avg >= 5 && latest < avg * 0.6) {
        flags.push(
          `${market}: ${num(Math.round(latest))} cases in ${period} is ${Math.round((1 - latest / avg) * 100)}% below its 3-month average of ${num(Math.round(avg))}.`
        );
      }
      if (avg >= 5 && latest === 0) {
        flags.push(`${market}: zero depletions reported in ${period} after averaging ${num(Math.round(avg))}/mo.`);
      }
    }
  }

  // market YTD that went backwards vs last year, from the snapshot block
  for (const s of report.snapshots) {
    if (s.ytdCasesLY && s.ytdCasesLY > 20 && s.ytdCases < s.ytdCasesLY * 0.7) {
      flags.push(
        `${s.market}: YTD ${num(Math.round(s.ytdCases))} cases is down ${Math.round((1 - s.ytdCases / s.ytdCasesLY) * 100)}% vs last year (${num(Math.round(s.ytdCasesLY))}).`
      );
    }
  }

  return flags;
}

/** Flags large swings in importer/distributor channel stock vs. the prior report. */
export async function analyzeLsiInventory(
  report: LsiInventoryReport,
  importerId: string,
  period: string
): Promise<string[]> {
  const flags: string[] = [];

  // total physical cases in this report
  const totalPhys =
    report.importerStock.reduce((a, r) => a + r.physCases, 0) +
    report.distributorStock.reduce((a, r) => a + r.physCases, 0);

  // the most recent prior period we have channel stock for this importer
  const prior = await db.channelStock.findFirst({
    where: { source: "REPORT", period: { lt: period } },
    orderBy: { period: "desc" },
  });
  if (prior) {
    const priorTotal = await db.channelStock.aggregate({
      where: { source: "REPORT", period: prior.period },
      _sum: { cases: true },
    });
    const priorCases = priorTotal._sum.cases ?? 0;
    // both sides are physical cases — compare directly
    if (priorCases >= 50 && totalPhys < priorCases * 0.5) {
      flags.push(
        `Channel stock (${num(Math.round(totalPhys))} cases) is less than half the prior report's ${num(Math.round(priorCases))} — verify the workbook is complete.`
      );
    }
    if (priorCases >= 50 && totalPhys > priorCases * 2) {
      flags.push(
        `Channel stock (${num(Math.round(totalPhys))} cases) more than doubled vs the prior report's ${num(Math.round(priorCases))} — large restock or a data issue.`
      );
    }
  }

  if (report.importerStock.length === 0) {
    flags.push("No importer (LSI) stock rows found — only distributor stock will import.");
  }
  if (report.distributorStock.length === 0) {
    flags.push("No distributor stock rows found — only importer stock will import.");
  }

  return flags;
}
