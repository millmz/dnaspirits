import { db } from "./db";

export type MarketRow = {
  productId: string;
  sku: string;
  name: string;
  tier: string;
  channelCases: number; // latest importer + distributor stock reports
  velocityCasesPerMonth: number; // avg of last 3 reported depletion months
  weeksOfSupply: number | null; // null = no velocity data yet
};

/**
 * Channel position per product: how much stock sits in the market
 * (importer + distributors, latest report per holder) vs. how fast it
 * depletes (3-month average). weeksOfSupply is the restock clock.
 */
export async function getMarketPosition(): Promise<MarketRow[]> {
  const [products, stocks, depletions, skuDepletions] = await Promise.all([
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
    db.channelStock.findMany(),
    db.depletion.findMany(),
    db.skuDepletion.findMany(),
  ]);

  return products.map((p) => {
    // latest report per holder (importer or specific distributor)
    const mine = stocks.filter((s) => s.productId === p.id);
    const latestByHolder = new Map<string, { period: string; cases: number }>();
    for (const s of mine) {
      const key = s.holderType === "IMPORTER" ? `imp:${s.importerId}` : `dist:${s.distributorId}`;
      const cur = latestByHolder.get(key);
      if (!cur || s.period > cur.period) {
        latestByHolder.set(key, { period: s.period, cases: s.cases });
      }
    }
    const channelCases = [...latestByHolder.values()].reduce((a, x) => a + x.cases, 0);

    // velocity: average of the 3 most recent months that have depletion data.
    // Per-SKU rows from the commercial report ("Variants") plus any
    // SKU-tagged manual/CSV depletion records.
    const byPeriod = new Map<string, number>();
    for (const d of depletions.filter((d) => d.productId === p.id)) {
      byPeriod.set(d.period, (byPeriod.get(d.period) ?? 0) + d.cases);
    }
    for (const d of skuDepletions.filter((d) => d.productId === p.id)) {
      byPeriod.set(d.period, (byPeriod.get(d.period) ?? 0) + d.cases);
    }
    const recent = [...byPeriod.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 3);
    const velocity =
      recent.length > 0 ? recent.reduce((a, [, c]) => a + c, 0) / recent.length : 0;

    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      tier: p.tier,
      channelCases,
      velocityCasesPerMonth: velocity,
      weeksOfSupply: velocity > 0 ? (channelCases / velocity) * 4.33 : null,
    };
  });
}
