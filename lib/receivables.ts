import { db } from "./db";

export type OpenReceivable = {
  saleId: string;
  importerName: string;
  invoiceNumber: string;
  date: Date;
  totalCents: number;
  creditsCents: number; // chargebacks applied against this invoice
  netDueCents: number;
};

/**
 * Open receivables net of applied chargeback credits — the importer settles
 * billbacks against what they owe, so the collectible number is invoice
 * total minus applied credits. Every AR figure in the app uses this.
 */
export async function getOpenReceivables(): Promise<{
  items: OpenReceivable[];
  totalNetCents: number;
}> {
  const unpaid = await db.exWorksSale.findMany({
    where: { status: "CONFIRMED", invoiceStatus: "UNPAID" },
    include: { importer: true, lines: true, chargebacks: true },
    orderBy: { date: "asc" },
  });
  const items = unpaid.map((s) => {
    const totalCents = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
    const creditsCents = s.chargebacks.reduce((a, c) => a + c.amountCents, 0);
    return {
      saleId: s.id,
      importerName: s.importer.name,
      invoiceNumber: s.invoiceNumber,
      date: s.date,
      totalCents,
      creditsCents,
      netDueCents: Math.max(0, totalCents - creditsCents),
    };
  });
  return { items, totalNetCents: items.reduce((a, i) => a + i.netDueCents, 0) };
}
