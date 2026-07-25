import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { db } from "./db";
import { agentEnabled } from "./agent";

/**
 * Universal document extraction for the Review Inbox. Any document that the
 * deterministic parsers don't recognize (supplier invoices, chargeback
 * statements, permits, depletion lists, production summaries, receipts…) is
 * read by Claude and mapped onto ONE of the platform's data categories, with
 * records extracted in a canonical shape and entities matched against the
 * live catalog (suppliers, components, products, distributors).
 *
 * The output is staged as a PendingImport for human review — approval commits
 * exactly the JSON the human saw (lib/import-commit.ts → commitAiExtract),
 * and commits are deliberately conservative: purchase orders land as ORDERED,
 * sales as DRAFT, production runs as PLANNED. Nothing moves inventory until
 * a person completes it in the app.
 */

export const AI_CATEGORIES = [
  "PURCHASE_ORDER",
  "EXPENSE",
  "CHARGEBACK",
  "LEGAL_RECORD",
  "DEPLETION_REPORT",
  "EX_WORKS_SALE",
  "PRODUCTION_RUN",
  "OTHER",
] as const;

export type AiCategory = (typeof AI_CATEGORIES)[number];

export type AiRecord = {
  date: string; // YYYY-MM-DD or ""
  endDate: string; // due/paid/bottled date or ""
  name: string; // vendor / component / account / title / product / lot code
  reference: string; // PO no. / invoice no. / serial / statement ref or ""
  subCategory: string; // category-specific enum value or ""
  amountCents: number; // USD cents, 0 if n/a
  qty: number; // units / cases / bottles, 0 if n/a
  unitCostCents: number; // per-unit USD cents, 0 if n/a
  matchedId: string; // id from the provided catalog, "" if no match
  notes: string;
};

export type AiExtraction = {
  category: AiCategory;
  summary: string;
  anomalies: string[];
  period: string; // YYYY-MM or ""
  docDate: string; // YYYY-MM-DD or ""
  reference: string; // document-level PO/invoice/statement number or ""
  entityId: string; // matched supplier/distributor/importer id or ""
  entityName: string; // entity name as written in the document
  records: AiRecord[];
};

const RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "date", "endDate", "name", "reference", "subCategory",
    "amountCents", "qty", "unitCostCents", "matchedId", "notes",
  ],
  properties: {
    date: { type: "string", description: "Primary date YYYY-MM-DD, or empty string" },
    endDate: { type: "string", description: "Due / renewal / bottled / paid date YYYY-MM-DD, or empty" },
    name: { type: "string", description: "Line name: vendor, component, account, trademark title, product, or lot code" },
    reference: { type: "string", description: "Line-level reference number, or empty" },
    subCategory: {
      type: "string",
      description:
        "Category-specific value. EXPENSE: COGS|DRY_GOODS|LOGISTICS|COMPLIANCE|MARKETING|G_AND_A|OTHER. " +
        "CHARGEBACK: DISTRIBUTOR_PROMO|SAMPLES|FREIGHT|MARKETING|OTHER. " +
        "LEGAL_RECORD: TRADEMARK|PERMIT|DOCUMENT|DEADLINE. " +
        "DEPLETION_REPORT: ON_PREMISE|OFF_PREMISE|UNKNOWN. Otherwise empty.",
    },
    amountCents: { type: "integer", description: "Total money amount in USD cents (convert currencies, note the rate in notes), 0 if n/a" },
    qty: { type: "number", description: "Quantity: units, PHYSICAL cases, or bottles depending on category (never 9L equivalents — convert if the document uses them). PRODUCTION_RUN lines matched to a product: whole BOTTLES (convert liters via the product's sizeMl). 0 if n/a" },
    unitCostCents: { type: "integer", description: "Per-unit cost in USD cents, 0 if n/a" },
    matchedId: { type: "string", description: "EXACT id from the catalog below when this line maps to an existing component/product, else empty" },
    notes: { type: "string", description: "Anything the reviewer should know about this line" },
  },
} as const;

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "category", "summary", "anomalies", "period", "docDate",
    "reference", "entityId", "entityName", "records",
  ],
  properties: {
    category: { type: "string", enum: [...AI_CATEGORIES] },
    summary: { type: "string", description: "2-4 sentence review note for the founder: what this is, what will be imported, anything off" },
    anomalies: { type: "array", items: { type: "string" }, description: "Specific things worth a second look (odd totals, missing data, expired dates)" },
    period: { type: "string", description: "YYYY-MM the document covers, or empty" },
    docDate: { type: "string", description: "Document date YYYY-MM-DD, or empty" },
    reference: { type: "string", description: "Document-level PO / invoice / statement number, or empty" },
    entityId: { type: "string", description: "EXACT id from the catalog when the counterparty matches an existing supplier/distributor/importer, else empty" },
    entityName: { type: "string", description: "Counterparty name as written in the document" },
    records: { type: "array", items: RECORD_SCHEMA },
  },
} as const;

const SYSTEM =
  "You are the operations analyst for De Nada Tequila (DNA Spirits LLC), an additive-free tequila " +
  "brand producing at NOM 1414 in Mexico and selling ex-works to a US importer (LSI). You read " +
  "business documents and extract structured data for the ops platform. Classify the document into " +
  "exactly one category and extract every line item faithfully — never invent numbers. Money is USD " +
  "cents; if the document is in MXN or another currency, convert using the rate stated in the " +
  "document if present, otherwise leave amounts in the original currency ONLY if clearly flagged in " +
  "notes, preferring 0 with a note over a wrong number. Match counterparties and line items to the " +
  "catalog ids provided when the names clearly correspond; leave matchedId empty when unsure. " +
  "Category guide: PURCHASE_ORDER = supplier order/invoice for dry goods (empty bottles, labels, " +
  "shippers, caps) or unbottled bulk liquid bought as a component. EXPENSE = operating cost " +
  "receipt/invoice not tied to dry-goods stock. CHARGEBACK = importer billback/credit statement. " +
  "LEGAL_RECORD = permit, license, trademark, certificate, agreement. DEPLETION_REPORT = " +
  "distributor account-level depletion list. EX_WORKS_SALE = De Nada's own invoice TO the importer. " +
  "PRODUCTION_RUN = bottling/production report OR a distillery invoice/proforma for finished " +
  "bottled tequila — if the document has a bottling line or finished-goods quantities, it is a " +
  "PRODUCTION_RUN, not a purchase order. For PRODUCTION_RUN: one record per expression " +
  "(blanco/reposado/añejo), matchedId = the corresponding product, and qty MUST be whole BOTTLES — " +
  "when the document quantifies liquid in liters, convert with the matched product's bottle size " +
  "(liters ÷ (sizeMl/1000), rounded; e.g. 4,176 L at 700ml = 5,966 bottles) and state the " +
  "conversion in notes. When the document shows the stock is ALREADY bottled (an invoiced bottling " +
  "line, a final/proforma-final invoice for finished stock, bottled quantities) set endDate on each " +
  "product record to the bottled or document date — those runs post straight into finished-goods " +
  "stock on approval. Leave endDate empty only for production that hasn't been bottled yet. " +
  "Service lines (bottling, labor) stay unmatched with their amount so the importer can spread the " +
  "cost. Put each line's invoice amount in amountCents. OTHER = nothing importable.";

const IMAGE_MIMES: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/** Turn the raw upload into Claude content blocks (PDF, image, spreadsheet→CSV, or text). */
export function documentBlocks(buf: Buffer, filename: string): Anthropic.ContentBlockParam[] {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") {
    return [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
      },
    ];
  }
  if (IMAGE_MIMES[ext]) {
    return [
      {
        type: "image",
        source: { type: "base64", media_type: IMAGE_MIMES[ext], data: buf.toString("base64") },
      },
    ];
  }
  if (["xlsx", "xls", "csv"].includes(ext)) {
    const wb = XLSX.read(buf, { type: "buffer" });
    const parts: string[] = [];
    for (const name of wb.SheetNames.slice(0, 8)) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]).slice(0, 40_000);
      parts.push(`=== Sheet: ${name} ===\n${csv}`);
    }
    return [{ type: "text", text: `Spreadsheet "${filename}" as CSV:\n\n${parts.join("\n\n")}` }];
  }
  // fall back to plain text
  return [{ type: "text", text: `Document "${filename}":\n\n${buf.toString("utf8").slice(0, 60_000)}` }];
}

/** Compact catalog of existing entities so Claude can return real ids. */
async function catalogText(): Promise<string> {
  const [suppliers, components, products, distributors, importers] = await Promise.all([
    db.supplier.findMany({ select: { id: true, name: true } }),
    db.component.findMany({ where: { active: true }, select: { id: true, name: true, category: true } }),
    db.product.findMany({ select: { id: true, name: true, sizeMl: true } }),
    db.distributor.findMany({ select: { id: true, name: true, market: true } }),
    db.importer.findMany({ select: { id: true, name: true } }),
  ]);
  const line = (rows: { id: string; name: string; extra?: string }[]) =>
    rows.map((r) => `  ${r.id} = ${r.name}${r.extra ? ` (${r.extra})` : ""}`).join("\n");
  return [
    "SUPPLIERS:", line(suppliers),
    "COMPONENTS (dry goods):", line(components.map((c) => ({ id: c.id, name: c.name, extra: c.category }))),
    "PRODUCTS:", line(products.map((p) => ({ id: p.id, name: p.name, extra: `${p.sizeMl}ml` }))),
    "DISTRIBUTORS:", line(distributors.map((d) => ({ id: d.id, name: d.name, extra: d.market || undefined }))),
    "IMPORTERS:", line(importers),
  ].join("\n");
}

/**
 * Extract a document into a platform category. Returns null when the agent is
 * disabled or the call fails — callers fall back to the plain UNKNOWN flow.
 */
export async function extractDocument(buf: Buffer, filename: string): Promise<AiExtraction | null> {
  if (!agentEnabled()) return null;
  try {
    const client = new Anthropic();
    const catalog = await catalogText();
    const content: Anthropic.ContentBlockParam[] = [
      ...documentBlocks(buf, filename),
      {
        type: "text",
        text:
          `Filename: ${filename}\n\nExisting catalog (use these EXACT ids for entityId/matchedId when a ` +
          `name clearly matches; empty string otherwise):\n${catalog}\n\n` +
          `Classify this document and extract its records.`,
      },
    ];

    const resp = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: EXTRACT_SCHEMA },
      },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

    if (resp.stop_reason === "refusal") return null;
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) return null;
    const parsed = JSON.parse(text) as AiExtraction;
    if (!AI_CATEGORIES.includes(parsed.category)) return null;
    return parsed;
  } catch (e) {
    console.error("ai-extract failed:", e);
    return null;
  }
}
