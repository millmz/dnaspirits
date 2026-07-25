import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentEnabled } from "@/lib/agent";
import { num, dateStr } from "@/lib/format";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, btnSecondaryCls, EmptyState, Callout } from "@/components/ui";
import { uploadForReview, approveImport, rejectImport, deletePending } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { DropZone } from "@/components/drop-zone";

const KIND_LABEL: Record<string, string> = {
  COMMERCIAL_REPORT: "Commercial report",
  LSI_INVENTORY: "LSI inventory workbook",
  QB_PNL: "QuickBooks P&L",
  AI_EXTRACT: "AI extracted",
  UNKNOWN: "Unrecognized",
};

const CATEGORY_LABEL: Record<string, string> = {
  PURCHASE_ORDER: "Purchase order (dry goods)",
  EXPENSE: "Expenses",
  CHARGEBACK: "LSI chargebacks",
  LEGAL_RECORD: "Legal / IP register",
  DEPLETION_REPORT: "Account depletions",
  EX_WORKS_SALE: "Ex-works sale",
  PRODUCTION_RUN: "Production run",
  OTHER: "Reference only",
};

const CATEGORY_TARGET: Record<string, string> = {
  PURCHASE_ORDER: "creates an ORDERED purchase order — receive it in Purchasing to add stock",
  EXPENSE: "adds expense rows to Accounting",
  CHARGEBACK: "adds unapplied chargebacks — link them to invoices in Accounting",
  LEGAL_RECORD: "adds entries to the Legal register",
  DEPLETION_REPORT: "adds account-level depletion rows",
  EX_WORKS_SALE: "creates a DRAFT sale — confirm it to move inventory",
  PRODUCTION_RUN: "creates a PLANNED run — complete it in Production to add stock",
};

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const proposedLine = (kind: string, proposed: Record<string, unknown>): string => {
  if (kind === "COMMERCIAL_REPORT")
    return `${proposed.depletionRows} depletion rows · ${proposed.skuRows} SKU rows · ${proposed.markets} markets · ${proposed.chains} chains · ${proposed.months} months`;
  if (kind === "LSI_INVENTORY")
    return `${proposed.importerStockRows} importer rows · ${proposed.distributorStockRows} distributor rows`;
  if (kind === "QB_PNL") return `${proposed.rows} P&L lines · ${proposed.periods} months (${proposed.span})`;
  if (kind === "AI_EXTRACT") {
    const cat = String(proposed.category ?? "OTHER");
    const n = Array.isArray(proposed.records) ? proposed.records.length : 0;
    if (cat === "OTHER") return "Reference only — nothing to import automatically";
    return `${CATEGORY_LABEL[cat] ?? cat}: ${n} record${n === 1 ? "" : "s"} — ${CATEGORY_TARGET[cat] ?? ""}`;
  }
  return "Nothing to import automatically";
};

type AiRecordPreview = {
  date: string; name: string; reference: string; subCategory: string;
  amountCents: number; qty: number; matchedId: string;
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ staged?: string; approved?: string; err?: string }>;
}) {
  await requireOps();
  const { staged, approved, err } = await searchParams;

  const [pending, recent, importers] = await Promise.all([
    db.pendingImport.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" } }),
    db.pendingImport.findMany({
      where: { status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { reviewedAt: "desc" },
      take: 8,
    }),
    db.importer.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        label="Automation"
        title="Review Inbox"
        subtitle="Drop in a document — review what it finds, approve in one click."
      />

      {staged && (
        <Callout tone="green">
          Document staged as <span className="font-medium">{KIND_LABEL[staged] ?? staged}</span> — review it below and approve or reject.
        </Callout>
      )}
      {approved && <Callout tone="green">Imported. Depletions, channel stock, or financials have been updated.</Callout>}
      {err && <Callout tone="red">{err}</Callout>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`Awaiting review${pending.length ? ` (${pending.length})` : ""}`}>
            {pending.length === 0 ? (
              <EmptyState>Nothing waiting. Upload a document on the right to stage it for review.</EmptyState>
            ) : (
              <div className="space-y-4">
                {pending.map((p) => {
                  const anomalies: string[] = JSON.parse(p.anomalies || "[]");
                  const proposed = JSON.parse(p.proposed || "{}");
                  const canImport =
                    p.kind === "AI_EXTRACT"
                      ? proposed.category !== "OTHER"
                      : p.kind !== "UNKNOWN" && (p.kind === "QB_PNL" || Boolean(p.importerId));
                  const aiRecords: AiRecordPreview[] =
                    p.kind === "AI_EXTRACT" && Array.isArray(proposed.records) ? proposed.records : [];
                  return (
                    <div key={p.id} className="rounded-md border border-ink/12 bg-white/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">
                          {p.filename}
                          <span className="ml-2 text-xs font-normal text-slate">{dateStr(p.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {p.aiUsed && <Badge tone="blue">AI reviewed</Badge>}
                          <Badge tone={p.kind === "UNKNOWN" ? "amber" : "green"}>{KIND_LABEL[p.kind] ?? p.kind}</Badge>
                        </div>
                      </div>

                      <p className="mt-2 text-sm leading-relaxed text-ink/85">{p.summary}</p>

                      <div className="mt-2 text-xs text-slate">
                        <span className="brand-heading text-[11px]">Will import:</span> {proposedLine(p.kind, proposed)}
                      </div>

                      {aiRecords.length > 0 && (
                        <div className="mt-2 overflow-x-auto rounded-md border border-ink/8 bg-white/70">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="brand-heading border-b border-ink/10 text-left text-[10px] text-slate">
                                <th className="px-2 py-1">Date</th>
                                <th className="px-2 py-1">Item</th>
                                <th className="px-2 py-1">Type</th>
                                <th className="px-2 py-1 text-right">Qty</th>
                                <th className="px-2 py-1 text-right">Amount</th>
                                <th className="px-2 py-1">Match</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-ink/5">
                              {aiRecords.slice(0, 12).map((r, i) => (
                                <tr key={i}>
                                  <td className="px-2 py-1 whitespace-nowrap">{r.date || "—"}</td>
                                  <td className="px-2 py-1">{r.name}{r.reference ? ` (${r.reference})` : ""}</td>
                                  <td className="px-2 py-1">{r.subCategory || "—"}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{r.qty || "—"}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{r.amountCents ? money(r.amountCents) : "—"}</td>
                                  <td className="px-2 py-1">{r.matchedId ? <Badge tone="green">matched</Badge> : <Badge tone="amber">new</Badge>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {aiRecords.length > 12 && (
                            <p className="px-2 py-1 text-[10px] text-slate/70">…and {aiRecords.length - 12} more records</p>
                          )}
                        </div>
                      )}

                      {anomalies.length > 0 && (
                        <div className="mt-3 rounded-md bg-reposado/15 px-3 py-2 text-xs text-burnt">
                          <span className="brand-heading font-medium">Flagged for a look:</span>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4">
                            {anomalies.map((a, i) => <li key={i}>{a}</li>)}
                          </ul>
                        </div>
                      )}

                      {p.kind !== "UNKNOWN" && !canImport && (
                        <div className="mt-2 text-xs text-burnt">
                          No importer on file for this document — set one on the upload form and re-stage.
                        </div>
                      )}

                      <div className="mt-3 flex gap-2">
                        {canImport && (
                          <form action={approveImport}>
                            <input type="hidden" name="id" value={p.id} />
                            <SubmitButton>Approve &amp; import</SubmitButton>
                          </form>
                        )}
                        <form action={rejectImport}>
                          <input type="hidden" name="id" value={p.id} />
                          <SubmitButton variant="secondary">Reject</SubmitButton>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {recent.length > 0 && (
            <Card title="Recently reviewed">
              <div className="space-y-2">
                {recent.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 border-b border-ink/8 pb-2 text-sm last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <span className="font-medium">{p.filename}</span>
                      <span className="ml-2 text-xs text-slate">{p.result || (p.status === "REJECTED" ? "Rejected" : "")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.status === "APPROVED" ? <Badge tone="green">Imported</Badge> : <Badge>Rejected</Badge>}
                      <form action={deletePending}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="px-1 py-1.5 text-xs text-slate/50 transition-colors hover:text-burnt">Clear</button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Upload for review">
            <DropZone hint="Drop reports or documents here" importerId={importers[0]?.id} />
            <details className="group mt-4">
              <summary className="brand-heading cursor-pointer select-none text-xs text-slate/70 [&::-webkit-details-marker]:hidden">
                + Classic upload (choose importer)
              </summary>
              <form action={uploadForReview} className="mt-3 space-y-3">
                <Field label="Document (.xlsx, .csv, .pdf, image, .txt)">
                  <input
                    name="file"
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt"
                    required
                    className={inputCls}
                  />
                </Field>
                <Field label="Importer (for reports & inventory)">
                  <select name="importerId" className={inputCls}>
                    {importers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </Field>
                <SubmitButton>Stage for review</SubmitButton>
              </form>
            </details>
            <p className="mt-3 text-xs leading-relaxed text-slate/70">
                Known reports (commercial report, LSI workbook, QuickBooks P&amp;L) are parsed
                deterministically. Anything else — supplier invoices, chargeback statements, permits,
                depletion lists, production reports, receipts — is read by the AI and mapped to the
                right part of the platform. You review the extracted records, then approve.
              </p>
          </Card>

          <Card title="How it works">
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-ink/85">
              <li>Upload a document — nothing is imported yet.</li>
              <li>The agent classifies and parses it with the same engine as the one-click importers.</li>
              <li>It checks the numbers against your existing months and flags anything unusual.</li>
              <li>You approve (it imports, replacing that month) or reject.</li>
            </ol>
            <p className="mt-3 text-xs text-slate/70">
              {agentEnabled()
                ? "AI extraction is on — any document can be read and mapped to purchase orders, expenses, chargebacks, legal records, depletions, sales, or production runs."
                : "Set ANTHROPIC_API_KEY to turn on AI extraction of any document (invoices, permits, statements, receipts) into the right part of the platform. The three known report formats work without it."}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
