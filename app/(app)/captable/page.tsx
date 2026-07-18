import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, num, dateStr } from "@/lib/format";
import { PageHeader, Card, Stat, Table, Td, Badge, Field, inputCls, btnCls, EmptyState } from "@/components/ui";
import { createCapTableEntry, deleteCapTableEntry } from "./actions";
import { SubmitButton } from "@/components/submit-button";

const UNIT_TONES: Record<string, "blanco" | "green" | "amber"> = {
  VOTING: "green",
  ECONOMIC: "blanco",
  PREFERRED: "amber",
};

export default async function CapTablePage() {
  await requireAdmin();
  const entries = await db.capTableEntry.findMany({
    orderBy: [{ dateAcquired: "asc" }],
  });

  const totalUnits = entries.reduce((a, e) => a + e.units, 0);
  const capitalRaised = entries.reduce((a, e) => a + e.capitalCents, 0);

  // roll up by holder
  const byMember = new Map<
    string,
    { units: number; voting: number; capitalCents: number; rounds: Set<string> }
  >();
  for (const e of entries) {
    const key = e.member.trim();
    const m = byMember.get(key) ?? { units: 0, voting: 0, capitalCents: 0, rounds: new Set<string>() };
    m.units += e.units;
    if (e.unitType === "VOTING") m.voting += e.units;
    m.capitalCents += e.capitalCents;
    if (e.round) m.rounds.add(e.round);
    byMember.set(key, m);
  }
  const holders = [...byMember.entries()].sort((a, b) => b[1].units - a[1].units);

  // implied unit value from the most recent priced entry (capital ÷ units)
  const priced = entries.filter((e) => e.capitalCents > 0 && e.units > 0 && e.dateAcquired);
  const latest = priced.sort((a, b) => b.dateAcquired!.getTime() - a.dateAcquired!.getTime())[0];
  const unitValueCents = latest ? Math.round(latest.capitalCents / latest.units) : 0;
  const impliedValuationCents = Math.round(unitValueCents * totalUnits);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        label="Company · DNA Spirits LLC"
        title="Cap Table"
        subtitle="Membership units of DNA Spirits LLC (NY), per the A&R Operating Agreement. Visible to admins only — the operating agreement and unit certificates stay with counsel; this is the live ownership picture."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Units outstanding" value={num(Math.round(totalUnits))} hint={`${holders.length} holders`} />
        <Stat label="Capital raised" value={money(capitalRaised)} tone="agave" hint="Primary investments to date" />
        <Stat
          label="Last unit price"
          value={unitValueCents > 0 ? money(unitValueCents) : "—"}
          hint={latest ? `${latest.round || "round"} · ${dateStr(latest.dateAcquired)}` : ""}
        />
        <Stat
          label="Implied valuation"
          value={impliedValuationCents > 0 ? money(impliedValuationCents) : "—"}
          tone="reposado"
          hint="Units × last unit price"
        />
      </div>

      <Card title="Ownership by holder">
        {holders.length === 0 ? (
          <EmptyState>No cap table entries yet.</EmptyState>
        ) : (
          <Table
            headers={["Holder", "Units", "Ownership", "Voting units", "Capital in", "Rounds"]}
            align={["left", "right", "right", "right", "right", "left"]}
          >
            {holders.map(([name, m]) => (
              <tr key={name}>
                <Td className="font-medium">{name}</Td>
                <Td right>{num(Math.round(m.units))}</Td>
                <Td right className="font-medium">
                  {totalUnits > 0 ? ((m.units / totalUnits) * 100).toFixed(2) : "0"}%
                </Td>
                <Td right>{m.voting > 0 ? num(Math.round(m.voting)) : "—"}</Td>
                <Td right>{m.capitalCents > 0 ? money(m.capitalCents) : "—"}</Td>
                <Td className="text-xs text-slate">{[...m.rounds].join(", ")}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Unit ledger">
            {entries.length === 0 ? (
              <EmptyState>No entries yet.</EmptyState>
            ) : (
              <Table
                headers={["Date", "Member", "Type", "Units", "Round", "Capital", "Notes", ""]}
                align={["left", "left", "left", "right", "left", "right", "left", "left"]}
              >
                {entries.map((e) => (
                  <tr key={e.id}>
                    <Td>{e.dateAcquired ? dateStr(e.dateAcquired) : "—"}</Td>
                    <Td>{e.member}</Td>
                    <Td><Badge tone={UNIT_TONES[e.unitType] ?? "gray"}>{e.unitType.toLowerCase()}</Badge></Td>
                    <Td right>{num(e.units)}</Td>
                    <Td className="text-xs">{e.round || "—"}</Td>
                    <Td right>{e.capitalCents > 0 ? money(e.capitalCents) : "—"}</Td>
                    <Td className="max-w-48 text-xs text-slate">{e.notes}</Td>
                    <Td>
                      <form action={deleteCapTableEntry}>
                        <input type="hidden" name="id" value={e.id} />
                        <button className="px-1 py-1.5 text-xs text-slate/50 transition-colors hover:text-burnt">Delete</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <Card title="Record issuance / transfer" collapsible>
          <form action={createCapTableEntry} className="space-y-3">
            <Field label="Member">
              <input name="member" required placeholder="Investor or member name" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit type">
                <select name="unitType" className={inputCls}>
                  <option value="ECONOMIC">Economic</option>
                  <option value="VOTING">Voting</option>
                  <option value="PREFERRED">Preferred</option>
                </select>
              </Field>
              <Field label="Units">
                <input name="units" required placeholder="100" className={inputCls} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Round">
                <input name="round" placeholder="Bridge / Series A / Secondary" className={inputCls} />
              </Field>
              <Field label="Date">
                <input name="dateAcquired" type="date" defaultValue={today} className={inputCls} />
              </Field>
            </div>
            <Field label="Capital invested ($ — blank for transfers/founder units)">
              <input name="capital" placeholder="125000" className={inputCls} />
            </Field>
            <Field label="Notes">
              <input name="notes" placeholder="Valuation, source of units…" className={inputCls} />
            </Field>
            <SubmitButton>Add entry</SubmitButton>
            <p className="text-xs leading-relaxed text-slate/70">
              Keep this in lockstep with counsel&apos;s records — unit transfers are governed by
              Articles XIII–XV of the operating agreement.
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}
