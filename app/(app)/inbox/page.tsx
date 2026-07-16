import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentEnabled } from "@/lib/agent";
import { num, dateStr } from "@/lib/format";
import { PageHeader, Card, Badge, Field, inputCls, btnCls, btnSecondaryCls, EmptyState, Callout } from "@/components/ui";
import { uploadForReview, approveImport, rejectImport, deletePending } from "./actions";

const KIND_LABEL: Record<string, string> = {
  COMMERCIAL_REPORT: "Commercial report",
  LSI_INVENTORY: "LSI inventory workbook",
  QB_PNL: "QuickBooks P&L",
  UNKNOWN: "Unrecognized",
};

const proposedLine = (kind: string, proposed: Record<string, unknown>): string => {
  if (kind === "COMMERCIAL_REPORT")
    return `${proposed.depletionRows} depletion rows · ${proposed.skuRows} SKU rows · ${proposed.markets} markets · ${proposed.chains} chains · ${proposed.months} months`;
  if (kind === "LSI_INVENTORY")
    return `${proposed.importerStockRows} importer rows · ${proposed.distributorStockRows} distributor rows`;
  if (kind === "QB_PNL") return `${proposed.rows} P&L lines · ${proposed.periods} months (${proposed.span})`;
  return "Nothing to import automatically";
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
        subtitle="Drop a document here and the agent parses it, checks it against your history, and stages it for one-click approval. Nothing touches your data until you approve."
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
                  const canImport = p.kind !== "UNKNOWN" && (p.kind === "QB_PNL" || Boolean(p.importerId));
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
                            <button className={btnCls}>Approve &amp; import</button>
                          </form>
                        )}
                        <form action={rejectImport}>
                          <input type="hidden" name="id" value={p.id} />
                          <button className={btnSecondaryCls}>Reject</button>
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
                        <button className="text-xs text-slate/60 hover:text-burnt">Clear</button>
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
            <form action={uploadForReview} className="space-y-3">
              <Field label="Document (.xlsx, .csv, .pdf)">
                <input name="file" type="file" accept=".xlsx,.xls,.csv,.pdf" required className={inputCls} />
              </Field>
              <Field label="Importer (for reports & inventory)">
                <select name="importerId" className={inputCls}>
                  {importers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
              <button className={btnCls}>Stage for review</button>
              <p className="text-xs leading-relaxed text-slate/70">
                The agent detects the document type automatically — commercial report, LSI workbook,
                or QuickBooks P&amp;L — parses it, and checks the numbers against your history. You
                review the summary and any flags, then approve to import.
              </p>
            </form>
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
                ? "AI review is on — summaries and unrecognized-document reading are enabled."
                : "Set ANTHROPIC_API_KEY to turn on AI-written summaries and reading of unrecognized PDFs (permits, invoices). Parsing and anomaly checks work without it."}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
