import * as XLSX from "xlsx";

export type ReportDepletion = { market: string; period: string; cases: number };
export type ReportVariant = { variant: string; period: string; cases: number };
export type ReportSnapshot = {
  market: string;
  ytdCases: number;
  ytdCasesLY: number | null;
  accounts: number;
  accountsLY: number | null;
  velocity: number | null;
};
export type ReportChain = { chain: string; ytdCases: number; ytdCasesLY: number | null };
export type CommercialReport = {
  reportPeriod: string; // latest month in the Monthly sheet
  depletions: ReportDepletion[]; // by market (brand-level)
  variants: ReportVariant[]; // by SKU/variant (national)
  snapshots: ReportSnapshot[]; // YTD by market
  chains: ReportChain[]; // YTD by retail chain
  warnings: string[];
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseMonthHeader(h: unknown): string | null {
  const m = String(h ?? "").match(/([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()];
  return mm ? `${m[2]}-${mm}` : null;
}

const asNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || v === "--") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
};

const cellStr = (v: unknown) => String(v ?? "").trim();

/**
 * Parser for the importer's monthly "Commercial Report" workbook
 * (Karma-style export). Handles its stacked sections:
 *   Monthly sheet    — "Dist. STATE" block (market × month) and
 *                      "Variants" block (SKU × month), both in 9L equivs
 *   YTD Summary      — MARKET block (volume/accounts/velocity vs LY) and
 *                      TOP 20 CHAIN block (volume by retail chain)
 */
export function parseCommercialReport(buf: Buffer): CommercialReport {
  const wb = XLSX.read(buf, { type: "buffer" });
  const warnings: string[] = [];
  const depletions: ReportDepletion[] = [];
  const variants: ReportVariant[] = [];
  const snapshots: ReportSnapshot[] = [];
  const chains: ReportChain[] = [];
  let reportPeriod = "";

  // ---- Monthly sheet ----
  const monthlyName = wb.SheetNames.find((n) => /month/i.test(n));
  if (monthlyName) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[monthlyName], {
      header: 1,
      defval: "",
    });

    // label rows ("Brands" + section type in col C) mark each block
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const labelIdx = row.findIndex((c) => /^brands$/i.test(cellStr(c)));
      if (labelIdx === -1) continue;
      const sectionType = cellStr(row[labelIdx + 1]); // "Dist. STATE" | "Variants"
      const headerRow = rows[i - 1] ?? [];
      const monthCols: { col: number; period: string }[] = [];
      headerRow.forEach((c, idx) => {
        const p = parseMonthHeader(c);
        if (p) monthCols.push({ col: idx, period: p });
      });
      if (monthCols.length === 0) continue;
      const latest = monthCols.map((m) => m.period).sort().at(-1) ?? "";
      if (latest > reportPeriod) reportPeriod = latest;

      for (let j = i + 1; j < rows.length; j++) {
        const r = rows[j];
        const key = cellStr(r[labelIdx + 1]);
        const brand = cellStr(r[labelIdx]);
        if (!key && !brand) break; // blank row = end of block
        if (/depletion month/i.test(cellStr(r.join(" ")))) break; // next header
        if (!key || /^total$/i.test(key)) continue;
        for (const { col, period } of monthCols) {
          const cases = asNum(r[col]);
          if (cases === null || cases === 0) continue;
          if (/state/i.test(sectionType)) depletions.push({ market: key, period, cases });
          else if (/variant/i.test(sectionType)) variants.push({ variant: key, period, cases });
        }
      }
    }
    if (depletions.length === 0) warnings.push(`Sheet "${monthlyName}": no market depletion block found.`);
  } else {
    warnings.push('No "Monthly" sheet found — depletions not imported.');
  }

  // ---- YTD Summary sheet ----
  const ytdName = wb.SheetNames.find((n) => /ytd|summary/i.test(n));
  if (ytdName) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[ytdName], {
      header: 1,
      defval: "",
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const labelCell = row.findIndex((c) =>
        /^(market|top 20 chain)$/i.test(cellStr(c))
      );
      if (labelCell === -1) continue;
      const isMarket = /^market$/i.test(cellStr(row[labelCell]));
      const actCols = row
        .map((c, idx) => (/^act$/i.test(cellStr(c)) ? idx : -1))
        .filter((idx) => idx !== -1);
      const lyCols = row
        .map((c, idx) => (/^ly$/i.test(cellStr(c)) ? idx : -1))
        .filter((idx) => idx !== -1);
      if (actCols.length === 0) continue;

      for (let j = i + 1; j < rows.length; j++) {
        const r = rows[j];
        const name = cellStr(r[labelCell]);
        if (!name) break;
        if (/^total$/i.test(name)) break;
        const act = asNum(r[actCols[0]]);
        if (act === null) continue;
        if (isMarket) {
          snapshots.push({
            market: name,
            ytdCases: act,
            ytdCasesLY: asNum(r[lyCols[0]]),
            accounts: Math.round(asNum(r[actCols[1]]) ?? 0),
            accountsLY: (() => {
              const v = lyCols[1] !== undefined ? asNum(r[lyCols[1]]) : null;
              return v === null ? null : Math.round(v);
            })(),
            velocity: actCols[2] !== undefined ? asNum(r[actCols[2]]) : null,
          });
        } else {
          chains.push({ chain: name, ytdCases: act, ytdCasesLY: asNum(r[lyCols[0]]) });
        }
      }
    }
  }

  if (depletions.length === 0 && snapshots.length === 0) {
    warnings.push("Nothing recognizable found — is this the importer's commercial report?");
  }
  return { reportPeriod, depletions, variants, snapshots, chains, warnings };
}
