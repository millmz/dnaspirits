import { db } from "./db";
import { getStock } from "./inventory";

/**
 * The three tiers of De Nada inventory, side by side per SKU:
 *   1. Ours ......... bottled stock in our warehouses (movement ledger)
 *   2. LSI .......... the importer's on-hand stock (their monthly report)
 *   3. Distributors . stock sitting at distributors (same report)
 * Tiers 2 and 3 use each holder's most recent reported month, in 9L cases.
 */

export type PipelineRow = {
  productId: string;
  sku: string;
  name: string;
  tier: string;
  ownBottles: number;
  own9l: number; // our stock in 9L-equivalent cases
  lsi9l: number;
  dist9l: number;
  total9l: number;
  velocityCasesPerMonth: number; // 3-month average depletions (9L)
  weeksOfSupply: number | null; // market stock (LSI + distributors) vs velocity
};

export type DistributorHolding = {
  distributorId: string;
  distributor: string;
  market: string;
  period: string; // latest reported month for this holder+product
  productId: string;
  sku: string;
  cases: number;
};

export type InventoryPipeline = {
  rows: PipelineRow[];
  distributorHoldings: DistributorHolding[]; // per-distributor breakdown, latest report each
  lsiAsOf: string | null; // newest importer-stock period
  distAsOf: string | null; // newest distributor-stock period
  totals: { own9l: number; lsi9l: number; dist9l: number; total9l: number };
};

export async function getInventoryPipeline(): Promise<InventoryPipeline> {
  const [own, products, stocks, skuDepletions, depletions, distributors] = await Promise.all([
    getStock(),
    db.product.findMany({ where: { active: true }, orderBy: { sku: "asc" } }),
    db.channelStock.findMany({ include: { distributor: true } }),
    db.skuDepletion.findMany(),
    db.depletion.findMany(),
    db.distributor.findMany(),
  ]);

  const ownByProduct = new Map(own.map((s) => [s.productId, s]));
  let lsiAsOf: string | null = null;
  let distAsOf: string | null = null;

  const holdings: DistributorHolding[] = [];

  const rows: PipelineRow[] = products.map((p) => {
    const ownRow = ownByProduct.get(p.id);
    const ownBottles = ownRow?.totalBottles ?? 0;
    const own9l = (ownBottles * p.sizeMl) / 9000;

    // latest report per holder for this product
    const mine = stocks.filter((s) => s.productId === p.id);
    let lsi9l = 0;
    let dist9l = 0;
    const latestByHolder = new Map<string, { period: string; cases: number; holderType: string; distributorId: string | null }>();
    for (const s of mine) {
      const key = s.holderType === "IMPORTER" ? `imp:${s.importerId}` : `dist:${s.distributorId}`;
      const cur = latestByHolder.get(key);
      if (!cur || s.period > cur.period) {
        latestByHolder.set(key, {
          period: s.period,
          cases: s.cases,
          holderType: s.holderType,
          distributorId: s.distributorId,
        });
      }
    }
    for (const [, h] of latestByHolder) {
      if (h.holderType === "IMPORTER") {
        lsi9l += h.cases;
        if (!lsiAsOf || h.period > lsiAsOf) lsiAsOf = h.period;
      } else {
        dist9l += h.cases;
        if (!distAsOf || h.period > distAsOf) distAsOf = h.period;
        if (h.distributorId) {
          const d = distributors.find((x) => x.id === h.distributorId);
          holdings.push({
            distributorId: h.distributorId,
            distributor: d?.name ?? "Unknown",
            market: d?.market ?? "",
            period: h.period,
            productId: p.id,
            sku: p.sku,
            cases: h.cases,
          });
        }
      }
    }

    // velocity: 3-month average, report SKU rows authoritative per month
    // (manual rows only count for months the report doesn't cover)
    const byPeriod = new Map<string, number>();
    const reportPeriods = new Set(
      skuDepletions.filter((d) => d.productId === p.id).map((d) => d.period)
    );
    for (const d of skuDepletions.filter((d) => d.productId === p.id)) {
      byPeriod.set(d.period, (byPeriod.get(d.period) ?? 0) + d.cases);
    }
    for (const d of depletions.filter((d) => d.productId === p.id)) {
      if (reportPeriods.has(d.period)) continue;
      byPeriod.set(d.period, (byPeriod.get(d.period) ?? 0) + d.cases);
    }
    const recent = [...byPeriod.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3);
    const velocity = recent.length > 0 ? recent.reduce((a, [, c]) => a + c, 0) / recent.length : 0;
    const market9l = lsi9l + dist9l;

    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      tier: p.tier,
      ownBottles,
      own9l,
      lsi9l,
      dist9l,
      total9l: own9l + market9l,
      velocityCasesPerMonth: velocity,
      weeksOfSupply: velocity > 0 ? (market9l / velocity) * 4.33 : null,
    };
  });

  const totals = rows.reduce(
    (a, r) => ({
      own9l: a.own9l + r.own9l,
      lsi9l: a.lsi9l + r.lsi9l,
      dist9l: a.dist9l + r.dist9l,
      total9l: a.total9l + r.total9l,
    }),
    { own9l: 0, lsi9l: 0, dist9l: 0, total9l: 0 }
  );

  holdings.sort((a, b) => a.distributor.localeCompare(b.distributor) || a.sku.localeCompare(b.sku));

  return { rows, distributorHoldings: holdings, lsiAsOf, distAsOf, totals };
}
