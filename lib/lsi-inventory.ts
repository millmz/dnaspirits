import * as XLSX from "xlsx";

export type ImporterStockRow = { itemName: string; physCases: number };
export type DistributorStockRow = {
  state: string;
  distributor: string;
  itemName: string;
  physCases: number;
};
export type LsiInventoryReport = {
  reportPeriod: string | null; // parsed from filename (e.g. "04_2026"), if present
  importerStock: ImporterStockRow[];
  distributorStock: DistributorStockRow[];
  warnings: string[];
};

const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "--") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
};
const cellStr = (v: unknown) => String(v ?? "").trim();

export function periodFromFilename(name: string): string | null {
  // "De Nada Tequila 04 2026 Depletions..." / "04_2026" / "2026-04"
  let m = name.match(/(?:^|[^0-9])(0[1-9]|1[0-2])[\s_.-]+(20\d{2})(?:[^0-9]|$)/);
  if (m) return `${m[2]}-${m[1]}`;
  m = name.match(/(20\d{2})[\s_.-]+(0[1-9]|1[0-2])(?:[^0-9]|$)/);
  if (m) return `${m[1]}-${m[2]}`;
  return null;
}

/**
 * Parser for LSI's monthly "Depletions and Shipments" workbook.
 * We import the two inventory sheets (channel stock); depletions come from
 * the commercial report to avoid double-counting.
 *  - "LSI Inventory":          SKU / Item Description / PHYCS / WH Location
 *  - "Distributor Inventory":  Dist. STATE / Distributors / Item Names /
 *                              ... / Current On Hand in Units
 * Quantities are PHYSICAL cases (converted to 9L equivalents at import).
 */
export function parseLsiInventory(buf: Buffer, filename: string): LsiInventoryReport {
  const wb = XLSX.read(buf, { type: "buffer" });
  const warnings: string[] = [];
  const importerStock: ImporterStockRow[] = [];
  const distributorStock: DistributorStockRow[] = [];

  // ---- LSI (importer) inventory ----
  const lsiName = wb.SheetNames.find((n) => /lsi.*invent|importer.*invent/i.test(n));
  if (lsiName) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[lsiName], {
      header: 1,
      defval: "",
    });
    const headerIdx = rows.findIndex((r) => r.some((c) => /phycs|phys/i.test(cellStr(c))));
    if (headerIdx !== -1) {
      const header = rows[headerIdx].map(cellStr);
      const descCol = header.findIndex((c) => /item|description/i.test(c));
      const qtyCol = header.findIndex((c) => /phycs|phys/i.test(c));
      for (const r of rows.slice(headerIdx + 1)) {
        const itemName = cellStr(r[descCol]);
        const physCases = asNum(r[qtyCol]);
        if (!itemName || physCases === null) continue;
        importerStock.push({ itemName, physCases });
      }
    } else {
      warnings.push(`Sheet "${lsiName}": no PHYCS column found.`);
    }
  } else {
    warnings.push('No "LSI Inventory" sheet found.');
  }

  // ---- Distributor inventory ----
  const distName = wb.SheetNames.find((n) => /dist.*invent/i.test(n));
  if (distName) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[distName], {
      header: 1,
      defval: "",
    });
    const headerIdx = rows.findIndex((r) =>
      r.some((c) => /current on hand/i.test(cellStr(c)))
    );
    if (headerIdx !== -1) {
      const header = rows[headerIdx].map(cellStr);
      const stateCol = header.findIndex((c) => /state/i.test(c));
      const distCol = header.findIndex((c) => /^distributors?$/i.test(c));
      const itemCol = header.findIndex((c) => /item name/i.test(c));
      const qtyCol = header.findIndex((c) => /current on hand/i.test(c));
      for (const r of rows.slice(headerIdx + 1)) {
        const state = cellStr(r[stateCol]);
        const distributor = cellStr(r[distCol]);
        const itemName = cellStr(r[itemCol]);
        const physCases = asNum(r[qtyCol]);
        if (!distributor || /^total$/i.test(distributor) || /^total$/i.test(state)) continue;
        if (!itemName || physCases === null) continue;
        distributorStock.push({ state, distributor, itemName, physCases });
      }
    } else {
      warnings.push(`Sheet "${distName}": no "Current On Hand" column found.`);
    }
  } else {
    warnings.push('No "Distributor Inventory" sheet found.');
  }

  if (importerStock.length === 0 && distributorStock.length === 0) {
    warnings.push("Nothing recognizable found — is this LSI's Depletions and Shipments workbook?");
  }
  return {
    reportPeriod: periodFromFilename(filename),
    importerStock,
    distributorStock,
    warnings,
  };
}
