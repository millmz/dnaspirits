/**
 * Matches item names from importer reports to catalog products.
 * Real-world names vary a lot:
 *   "De Nada Tequila Blanco 6x700ml 40.0"        → tier + size
 *   "De Nada Tequila Blanco 6x700ml 40.0 CACRV"  → CA-deposit variant, same SKU
 *   "De Nada Tequila Reposado 6/750ml"           → legacy 750ml → closest size
 *   "De Nada Tequila Blanco"                     → tier only (commercial report)
 */

export type MatchableProduct = {
  id: string;
  name: string;
  sku: string;
  tier: string;
  sizeMl: number;
};

export function tierOf(itemName: string): string | null {
  return /cristalino/i.test(itemName)
    ? "OTHER"
    : /a[nñ]ejo/i.test(itemName)
    ? "ANEJO"
    : /reposado/i.test(itemName)
    ? "REPOSADO"
    : /blanco/i.test(itemName)
    ? "BLANCO"
    : null;
}

export function sizeOf(itemName: string): number | null {
  const ml = itemName.match(/(\d{3,4})\s*ml/i);
  if (ml) return parseInt(ml[1], 10);
  if (/\b1\s*l(iter|itre)?s?\b/i.test(itemName)) return 1000;
  return null;
}

/**
 * Resolution order: exact name/SKU → tier + exact size → tier + closest size
 * (with a note) → tier's smallest bottle when the name carries no size (with
 * a note). Notes surface in the import summary so mappings are never silent.
 */
export function matchProduct<P extends MatchableProduct>(
  itemName: string,
  products: P[]
): { product?: P; note?: string } {
  const lower = itemName.trim().toLowerCase();
  const exact = products.find(
    (p) => p.name.toLowerCase() === lower || p.sku.toLowerCase() === lower
  );
  if (exact) return { product: exact };

  const tier = tierOf(itemName);
  if (!tier) return {};
  const candidates = products.filter((p) => p.tier === tier);
  if (candidates.length === 0) return {};
  if (candidates.length === 1) return { product: candidates[0] };

  const size = sizeOf(itemName);
  if (size !== null) {
    const exactSize = candidates.find((p) => p.sizeMl === size);
    if (exactSize) return { product: exactSize };
    const closest = [...candidates].sort(
      (a, b) => Math.abs(a.sizeMl - size) - Math.abs(b.sizeMl - size)
    )[0];
    return {
      product: closest,
      note: `"${itemName}" (${size}ml) mapped to ${closest.sku} (closest size).`,
    };
  }

  const smallest = [...candidates].sort((a, b) => a.sizeMl - b.sizeMl)[0];
  return {
    product: smallest,
    note: `"${itemName}" carries no bottle size — mapped to ${smallest.sku}.`,
  };
}
