import { db } from "./db";

export type OpenReceivable = {
  saleId: string;
  importerName: string;
  invoiceNumber: string;
  date: Date;
  dueDate: Date | null;
  totalCents: number;
  creditsCents: number; // chargebacks applied against this invoice
  paidCents: number; // partial payments received
  netDueCents: number;
  ageDays: number; // since due date if set, else since invoice date
  overdue: boolean;
  overCredited: boolean; // applied credits exceed the invoice total
};

export type AgingBuckets = {
  current: number; // 0-30 days
  d31to60: number;
  d61to90: number;
  d90plus: number;
};

/**
 * Open receivables net of applied chargeback credits AND payments received —
 * the importer settles billbacks against what they owe and often remits in
 * parts. Every AR figure in the app uses this.
 */
export async function getOpenReceivables(): Promise<{
  items: OpenReceivable[];
  totalNetCents: number;
  aging: AgingBuckets;
}> {
  const unpaid = await db.exWorksSale.findMany({
    where: { status: "CONFIRMED", invoiceStatus: "UNPAID" },
    include: { importer: true, lines: true, chargebacks: true },
    orderBy: { date: "asc" },
  });
  const now = Date.now();
  const items = unpaid.map((s) => {
    const totalCents = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
    const creditsCents = s.chargebacks.reduce((a, c) => a + c.amountCents, 0);
    const anchor = (s.dueDate ?? s.date).getTime();
    const ageDays = Math.max(0, Math.floor((now - anchor) / 86_400_000));
    return {
      saleId: s.id,
      importerName: s.importer.name,
      invoiceNumber: s.invoiceNumber,
      date: s.date,
      dueDate: s.dueDate,
      totalCents,
      creditsCents,
      paidCents: s.amountPaidCents,
      netDueCents: Math.max(0, totalCents - creditsCents - s.amountPaidCents),
      ageDays,
      overdue: s.dueDate ? now > s.dueDate.getTime() : ageDays > 30,
      overCredited: creditsCents > totalCents,
    };
  });

  const aging: AgingBuckets = { current: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
  for (const i of items) {
    if (i.ageDays <= 30) aging.current += i.netDueCents;
    else if (i.ageDays <= 60) aging.d31to60 += i.netDueCents;
    else if (i.ageDays <= 90) aging.d61to90 += i.netDueCents;
    else aging.d90plus += i.netDueCents;
  }

  return { items, totalNetCents: items.reduce((a, i) => a + i.netDueCents, 0), aging };
}
