import * as XLSX from "xlsx";
import { db } from "./db";
import { num, money } from "./format";
import { parseCommercialReport } from "./commercial-report";
import { parseLsiInventory, periodFromFilename } from "./lsi-inventory";
import { parseQbPnl } from "./qb-pnl";
import { analyzeCommercialReport, analyzeLsiInventory } from "./anomaly";
import { writeReviewNote, agentEnabled } from "./agent";
import {
  commitCommercialReport,
  commitLsiInventory,
  commitQbPnl,
  commitAiExtract,
} from "./import-commit";
import { extractDocument, type AiExtraction } from "./ai-extract";

export type IngestKind = "COMMERCIAL_REPORT" | "LSI_INVENTORY" | "QB_PNL" | "AI_EXTRACT" | "UNKNOWN";

/** Sniffs a document's type from its sheet names / structure, deterministically. */
function classify(buf: Buffer, filename: string): IngestKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "UNKNOWN";
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer" });
  } catch {
    return "UNKNOWN";
  }
  const sheets = wb.SheetNames.map((n) => n.toLowerCase());
  if (sheets.some((n) => /lsi.*invent|distributor.*invent/.test(n))) return "LSI_INVENTORY";
  if (sheets.some((n) => /monthly/.test(n)) && sheets.some((n) => /ytd/.test(n)))
    return "COMMERCIAL_REPORT";
  // QB P&L by month: a sheet with month columns and Income/Expenses sections
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  if (firstSheet) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
    const looksPnl = rows
      .slice(0, 30)
      .some((r) => /profit and loss|income|cost of goods/i.test(String(r[0] ?? "")));
    if (looksPnl) return "QB_PNL";
  }
  if (/karma|commercial|depletion/.test(lower)) return "COMMERCIAL_REPORT";
  if (/lsi|shipment|inventory/.test(lower)) return "LSI_INVENTORY";
  return "UNKNOWN";
}

export type StageResult = { id: string; kind: IngestKind };

/**
 * The staging pipeline: classify → parse (deterministic) → analyze (deterministic
 * anomalies) → summarize (Claude, optional) → write a PENDING row for review.
 * Nothing touches live data here — that only happens on approval.
 */
export async function stageDocument(
  buf: Buffer,
  filename: string,
  importerId: string | null
): Promise<StageResult> {
  let kind = classify(buf, filename);
  const fileB64 = buf.toString("base64");
  let period = "";
  let facts = "";
  let anomalies: string[] = [];
  let proposed: Record<string, unknown> = {};

  if (kind === "COMMERCIAL_REPORT") {
    const report = parseCommercialReport(buf);
    period = report.reportPeriod;
    anomalies = await analyzeCommercialReport(report);
    const months = [...new Set(report.depletions.map((d) => d.period))].length;
    proposed = {
      reportPeriod: report.reportPeriod,
      months,
      depletionRows: report.depletions.length,
      skuRows: report.variants.length,
      markets: report.snapshots.length,
      chains: report.chains.length,
    };
    facts =
      `Commercial report, latest month ${report.reportPeriod}. ` +
      `${report.depletions.length} market-depletion rows across ${months} months, ` +
      `${report.variants.length} per-SKU rows, ${report.snapshots.length} market snapshots, ` +
      `${report.chains.length} chains.`;
    if (report.warnings.length) facts += ` Parser notes: ${report.warnings.slice(0, 4).join("; ")}.`;
  } else if (kind === "LSI_INVENTORY") {
    const report = parseLsiInventory(buf, filename);
    period = report.reportPeriod ?? periodFromFilename(filename) ?? "";
    if (importerId) anomalies = await analyzeLsiInventory(report, importerId, period);
    proposed = {
      period,
      importerStockRows: report.importerStock.length,
      distributorStockRows: report.distributorStock.length,
    };
    facts =
      `LSI Depletions & Shipments workbook for ${period || "an unknown month"}. ` +
      `${report.importerStock.length} importer stock rows, ` +
      `${report.distributorStock.length} distributor stock rows (physical cases).`;
    if (report.warnings.length) facts += ` Parser notes: ${report.warnings.slice(0, 4).join("; ")}.`;
  } else if (kind === "QB_PNL") {
    const parsed = parseQbPnl(buf);
    const periods = [...new Set(parsed.rows.map((r) => r.period))].sort();
    const income = parsed.rows.filter((r) => r.kind === "INCOME").reduce((a, r) => a + r.amountCents, 0);
    const expense = parsed.rows.filter((r) => r.kind === "EXPENSE").reduce((a, r) => a + r.amountCents, 0);
    proposed = { periods: periods.length, rows: parsed.rows.length, span: periods.length ? `${periods[0]}…${periods[periods.length - 1]}` : "" };
    facts =
      `QuickBooks P&L covering ${periods.length} month(s)` +
      (periods.length ? ` (${periods[0]} to ${periods[periods.length - 1]})` : "") +
      `. Income ${money(income)}, expenses ${money(expense)}, net ${money(income - expense)} across ${parsed.rows.length} account-lines.`;
    if (parsed.warnings.length) facts += ` Parser notes: ${parsed.warnings.slice(0, 3).join("; ")}.`;
    if (income - expense < 0) anomalies.push(`Net loss of ${money(expense - income)} across the uploaded months — confirm this matches the bookkeeper's statement.`);
  } else {
    facts = `Unrecognized document "${filename}". Not one of the known report formats (commercial report, LSI workbook, QB P&L).`;
  }

  // Not a known report format → let the AI read it and map it to any platform
  // category (PO, expense, chargeback, legal, depletions, sale, production).
  let extraction: AiExtraction | null = null;
  let summary = "";
  if (kind === "UNKNOWN" && agentEnabled()) {
    extraction = await extractDocument(buf, filename);
    if (extraction) {
      kind = "AI_EXTRACT" as IngestKind;
      period = extraction.period;
      anomalies = extraction.anomalies;
      proposed = extraction as unknown as Record<string, unknown>;
      summary = extraction.summary;
    }
  }

  if (!summary) {
    // Claude narrative (optional). For UNKNOWN PDFs, hand it the file to read.
    const note = await writeReviewNote({
      kind,
      filename,
      facts,
      anomalies,
      pdfBase64: kind === "UNKNOWN" && filename.toLowerCase().endsWith(".pdf") ? fileB64 : undefined,
    });
    summary = note ?? facts;
  }

  const pending = await db.pendingImport.create({
    data: {
      kind,
      filename,
      fileB64,
      importerId,
      period,
      summary,
      anomalies: JSON.stringify(anomalies),
      proposed: JSON.stringify(proposed),
      aiUsed: Boolean(extraction) || (agentEnabled() && Boolean(summary)),
      status: "PENDING",
    },
  });
  return { id: pending.id, kind };
}

/** Approves a staged import: re-parses the stored file and commits via the shared path. */
export async function approvePending(id: string): Promise<string> {
  const p = await db.pendingImport.findUniqueOrThrow({ where: { id } });
  if (p.status !== "PENDING") return p.result || "Already reviewed.";
  const buf = Buffer.from(p.fileB64, "base64");
  let result = "";

  if (p.kind === "COMMERCIAL_REPORT" && p.importerId) {
    const c = await commitCommercialReport(parseCommercialReport(buf), p.importerId);
    result = `Imported ${c.reportPeriod}: ${num(c.depletions)} depletion rows across ${c.months} months, ${c.skuRows} SKU rows, ${c.snapshots} markets, ${c.chains} chains.`;
  } else if (p.kind === "LSI_INVENTORY" && p.importerId) {
    const c = await commitLsiInventory(parseLsiInventory(buf, p.filename), p.importerId, p.period);
    result = `Imported ${c.period} channel stock: ${c.importerRows} importer product rows, ${c.distributorRows} distributor rows.`;
  } else if (p.kind === "QB_PNL") {
    const c = await commitQbPnl(parseQbPnl(buf).rows);
    result = `Imported ${c.rows} P&L lines across ${c.periods} month(s).`;
  } else if (p.kind === "AI_EXTRACT") {
    // Commit exactly the extraction the human reviewed and approved.
    const extraction = JSON.parse(p.proposed) as AiExtraction;
    result = await commitAiExtract(extraction, p.importerId);
  } else {
    result = "This document type can't be auto-imported — handle it manually.";
  }

  await db.pendingImport.update({
    where: { id },
    data: { status: "APPROVED", result, reviewedAt: new Date() },
  });
  return result;
}
