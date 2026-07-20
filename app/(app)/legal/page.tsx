import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateStr } from "@/lib/format";
import { PageHeader, Card, Table, Td, Badge, Field, inputCls, btnCls, EmptyState, Callout } from "@/components/ui";
import { createLegalRecord, setLegalStatus, deleteLegalRecord } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const TYPES = [
  ["DOCUMENT", "Documents & Governance"],
  ["TRADEMARK", "IP / Trademarks"],
  ["PERMIT", "Permits & Licenses"],
  ["DEADLINE", "Filings & Deadlines"],
] as const;

const TYPE_TONES: Record<string, "gray" | "green" | "blue" | "amber"> = {
  DOCUMENT: "gray",
  TRADEMARK: "green",
  PERMIT: "blue",
  DEADLINE: "amber",
};

export default async function LegalPage() {
  await requireAdmin();
  const records = await db.legalRecord.findMany({
    orderBy: [{ type: "asc" }, { dueDate: "asc" }, { executed: "asc" }],
  });

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const upcoming = records
    .filter((r) => r.status === "ACTIVE" && r.dueDate)
    .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime());
  const urgent = upcoming.filter((r) => r.dueDate!.getTime() - now < 120 * day);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        label="Company · DNA Spirits LLC"
        title="Legal & IP"
        subtitle="Documents, trademarks, permits, and deadlines."
      />

      {urgent.length > 0 && (
        <Callout tone="amber">
          <span className="font-medium">Coming due:</span>{" "}
          {urgent
            .map((r) => {
              const d = Math.ceil((r.dueDate!.getTime() - now) / day);
              return `${r.title} — ${dateStr(r.dueDate)} (${d < 0 ? `${-d} days OVERDUE` : `${d} days`})`;
            })
            .join(" · ")}
        </Callout>
      )}

      <div className="space-y-6">
        {TYPES.map(([type, label]) => {
          const rows = records.filter((r) => r.type === type);
          return (
            <Card key={type} title={label}>
              {rows.length === 0 ? (
                <EmptyState>
                  {type === "TRADEMARK"
                    ? "Add your USPTO marks with their serial/registration numbers — renewal windows get tracked here."
                    : "Nothing recorded yet."}
                </EmptyState>
              ) : (
                <Table
                  headers={["Title", "Reference", "Jurisdiction", "Executed / filed", "Due", "Status", "Notes", ""]}
                  align={["left", "left", "left", "left", "left", "left", "left", "left"]}
                >
                  {rows.map((r) => {
                    const daysLeft = r.dueDate ? Math.ceil((r.dueDate.getTime() - now) / day) : null;
                    return (
                      <tr key={r.id}>
                        <Td className="font-medium">
                          {r.link ? (
                            <a href={r.link} target="_blank" rel="noreferrer" className="text-agave-deep underline">
                              {r.title}
                            </a>
                          ) : (
                            r.title
                          )}
                        </Td>
                        <Td className="font-mono text-xs">{r.reference || "—"}</Td>
                        <Td className="text-xs">{r.jurisdiction || "—"}</Td>
                        <Td>{r.executed ? dateStr(r.executed) : "—"}</Td>
                        <Td className={daysLeft !== null && daysLeft < 120 && r.status === "ACTIVE" ? "font-medium text-burnt" : ""}>
                          {r.dueDate ? `${dateStr(r.dueDate)}${r.status === "ACTIVE" && daysLeft !== null ? ` (${daysLeft}d)` : ""}` : "—"}
                        </Td>
                        <Td>
                          {r.status === "ACTIVE" ? (
                            <Badge tone={TYPE_TONES[r.type]}>Active</Badge>
                          ) : r.status === "DONE" ? (
                            <Badge tone="green">Done</Badge>
                          ) : (
                            <Badge tone="red">Expired</Badge>
                          )}
                        </Td>
                        <Td className="max-w-56 text-xs text-slate">{r.notes}</Td>
                        <Td>
                          <div className="flex gap-2 text-xs">
                            {r.status === "ACTIVE" && r.dueDate && (
                              <form action={setLegalStatus}>
                                <input type="hidden" name="id" value={r.id} />
                                <input type="hidden" name="status" value="DONE" />
                                <button className="text-agave-deep hover:underline">Done</button>
                              </form>
                            )}
                            <form action={deleteLegalRecord}>
                              <input type="hidden" name="id" value={r.id} />
                              <button className="text-slate/60 hover:text-burnt">Delete</button>
                            </form>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Add record" collapsible>
          <form action={createLegalRecord} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select name="type" className={inputCls}>
                  {TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
              <Field label="Reference #">
                <input name="reference" placeholder="USPTO serial / permit no." className={inputCls} />
              </Field>
            </div>
            <Field label="Title">
              <input name="title" required placeholder="DE NADA word mark — Class 33" className={inputCls} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Jurisdiction">
                <input name="jurisdiction" placeholder="USPTO / NY / TTB / MX" className={inputCls} />
              </Field>
              <Field label="Executed / filed">
                <input name="executed" type="date" className={inputCls} />
              </Field>
              <Field label="Due date">
                <input name="dueDate" type="date" className={inputCls} />
              </Field>
            </div>
            <Field label="Link (drive folder, USPTO TSDR, etc.)">
              <input name="link" placeholder="https://tsdr.uspto.gov/#caseNumber=…" className={inputCls} />
            </Field>
            <Field label="Notes">
              <input name="notes" placeholder="Renewal window, counsel contact…" className={inputCls} />
            </Field>
            <SubmitButton>Add record</SubmitButton>
          </form>
        </Card>

        <Card title="What belongs here">
          <div className="space-y-3 text-sm leading-relaxed text-ink/85">
            <p>
              <span className="font-medium">Trademarks:</span> add each USPTO mark with its serial number and
              link to <a className="text-agave-deep underline" href="https://tsdr.uspto.gov" target="_blank" rel="noreferrer">TSDR</a>.
              Track the §8 declaration window (years 5–6 after registration) and §8/§9 renewal (years 9–10) as
              due dates — missing them cancels the mark.
            </p>
            <p>
              <span className="font-medium">Permits:</span> TTB importer/wholesaler basic permits, state brand
              registrations and price postings, and the Mexican side (CRT export, NOM certification) — each with
              its renewal cycle.
            </p>
            <p>
              <span className="font-medium">Filings:</span> NY biennial statement (anniversary month of formation,
              every two years), franchise/annual taxes, insurance renewals.
            </p>
            <p className="text-xs text-slate/70">
              This page holds the index and the clock, on purpose — executed originals live with counsel and in
              drive storage, valuations and waterfalls live with your accountant and the operating agreement.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
