import { db } from "./db";

/**
 * De Nada tracks PHYSICAL cases everywhere — a real sellable case (6×700ml),
 * not the industry's 9L equivalent. Sources that report in 9L (the importer's
 * commercial report) are converted to physical at import time, per product
 * when the row names a SKU, else with the brand's standard case.
 */

/** ml of liquid in one physical case of a product */
export const caseMl = (p: { bottlesPerCase: number; sizeMl: number }) =>
  p.bottlesPerCase * p.sizeMl;

/** 9L-equivalent cases → physical cases for a known product */
export const physFrom9L = (nineL: number, p: { bottlesPerCase: number; sizeMl: number }) =>
  (nineL * 9000) / caseMl(p);

/**
 * The brand's standard physical case in ml, for brand-level rows that don't
 * name a SKU (market depletions, YTD state snapshots, chain volumes). The
 * most common case spec across active products — 6×700ml = 4200ml today.
 */
export async function brandCaseMl(): Promise<number> {
  const products = await db.product.findMany({ where: { active: true } });
  if (products.length === 0) return 4200;
  const counts = new Map<number, number>();
  for (const p of products) {
    const ml = caseMl(p);
    counts.set(ml, (counts.get(ml) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One-time data migration: rows written before the physical-cases switch are
 * stored as 9L equivalents — multiply them into physicals. Guarded by a
 * Setting flag so it runs exactly once per database; new installs no-op.
 */
export async function migrateToPhysicalCases(): Promise<string | null> {
  const FLAG = "units-physical-v1";
  if (await db.setting.findUnique({ where: { key: FLAG } })) return null;

  const [products, brandMl] = await Promise.all([db.product.findMany(), brandCaseMl()]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const factorFor = (productId: string | null) => {
    const p = productId ? byId.get(productId) : undefined;
    return 9000 / (p ? caseMl(p) : brandMl);
  };

  let rows = 0;
  const [depletions, skuDepletions, channelStocks, snapshots, chains] = await Promise.all([
    db.depletion.findMany(),
    db.skuDepletion.findMany(),
    db.channelStock.findMany(),
    db.marketSnapshot.findMany(),
    db.chainVolume.findMany(),
  ]);

  await db.$transaction([
    ...depletions.map((d) =>
      db.depletion.update({ where: { id: d.id }, data: { cases: r2(d.cases * factorFor(d.productId)) } })
    ),
    ...skuDepletions.map((d) =>
      db.skuDepletion.update({ where: { id: d.id }, data: { cases: r2(d.cases * factorFor(d.productId)) } })
    ),
    ...channelStocks.map((s) =>
      db.channelStock.update({ where: { id: s.id }, data: { cases: r2(s.cases * factorFor(s.productId)) } })
    ),
    ...snapshots.map((s) => {
      const f = factorFor(null);
      return db.marketSnapshot.update({
        where: { id: s.id },
        data: {
          ytdCases: r2(s.ytdCases * f),
          ytdCasesLY: s.ytdCasesLY === null ? null : r2(s.ytdCasesLY * f),
          velocity: s.velocity === null ? null : r2(s.velocity * f),
        },
      });
    }),
    ...chains.map((c) => {
      const f = factorFor(null);
      return db.chainVolume.update({
        where: { id: c.id },
        data: {
          ytdCases: r2(c.ytdCases * f),
          ytdCasesLY: c.ytdCasesLY === null ? null : r2(c.ytdCasesLY * f),
        },
      });
    }),
  ]);
  rows = depletions.length + skuDepletions.length + channelStocks.length + snapshots.length + chains.length;

  const summary = `Converted ${rows} rows from 9L to physical cases (brand case ${brandMl}ml).`;
  await db.setting.create({ data: { key: FLAG, value: summary } });
  return summary;
}
