import * as XLSX from "xlsx";

export type PnlRow = {
  period: string; // YYYY-MM
  account: string;
  kind: "INCOME" | "EXPENSE";
  amountCents: number; // signed — contra lines (refunds, discounts) stay negative
};
export type PnlParse = { rows: PnlRow[]; warnings: string[] };

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Jan 2021" / "January 2021" / "Jan-21" / "2021-01" / Date cell → YYYY-MM */
export function parsePeriodHeader(raw: unknown): string | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString().slice(0, 7);
  const s = String(raw ?? "").trim();
  if (!s || /^total/i.test(s)) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^([a-z]{3,9})[\s\-'’.,]*(\d{2,4})$/i);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!mon) return null;
    const y = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${y}-${mon}`;
  }
  return null;
}

const asNum = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!s || s === "-" || s === "--") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

/**
 * Parses QuickBooks' native "Profit and Loss by Month" export (xlsx or csv):
 * account rows down the side, month columns across, section headers
 * (Income / COGS / Expenses / Other …) grouping the accounts. Subtotal rows
 * ("Total …", "Gross Profit", "Net …") are skipped — only leaf accounts load,
 * so sums stay correct. Works on a single year or many years in one file.
 */
export function parseQbPnl(buf: Buffer): PnlParse {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const warnings: string[] = [];
  const rows: PnlRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
    });

    // header row = the one with the most parseable month columns
    let headerIdx = -1;
    let periods: (string | null)[] = [];
    let best = 0;
    for (let i = 0; i < Math.min(grid.length, 12); i++) {
      const parsed = grid[i].map(parsePeriodHeader);
      const count = parsed.filter(Boolean).length;
      if (count > best) {
        best = count;
        headerIdx = i;
        periods = parsed;
      }
    }
    if (headerIdx === -1 || best === 0) continue; // not a by-month sheet

    let section: "INCOME" | "EXPENSE" | null = null;
    for (const row of grid.slice(headerIdx + 1)) {
      const label = String(row[0] ?? "").trim();
      if (!label) continue;

      // section headers & subtotals
      if (/^(ordinary\s+)?(income|revenue)s?$/i.test(label) || /^other\s+income$/i.test(label)) {
        section = "INCOME";
        continue;
      }
      if (
        /^(cost of goods sold|cogs)$/i.test(label) ||
        /^(operating\s+)?expenses?$/i.test(label) ||
        /^other\s+expenses?$/i.test(label)
      ) {
        section = "EXPENSE";
        continue;
      }
      if (/^(total|gross profit|net\s|net income|net operating|net other)/i.test(label)) continue;
      if (!section) continue;

      for (let c = 1; c < row.length; c++) {
        const period = periods[c];
        if (!period) continue;
        const amount = asNum(row[c]);
        if (amount === null || amount === 0) continue;
        rows.push({
          period,
          account: label,
          kind: section,
          amountCents: Math.round(amount * 100),
        });
      }
    }
  }

  if (rows.length === 0) {
    warnings.push(
      'No month columns with amounts found — is this a QuickBooks "Profit and Loss by Month" export?'
    );
  }
  return { rows, warnings };
}
