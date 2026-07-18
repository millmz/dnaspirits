import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, num, dateStr } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

/**
 * Printable invoice for an ex-works sale — use the browser's Print → Save as
 * PDF to send it. Standalone page (no app chrome) so it prints clean.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(); // bookkeepers included
  const { id } = await params;
  const sale = await db.exWorksSale.findUnique({
    where: { id },
    include: { importer: true, warehouse: true, lines: { include: { product: true } }, chargebacks: true },
  });
  if (!sale) notFound();

  const invoiceNo = sale.invoiceNumber || `DN-${sale.id.slice(-6).toUpperCase()}`;
  const subtotal = sale.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
  const credits = sale.chargebacks.reduce((a, c) => a + c.amountCents, 0);
  const balance = Math.max(0, subtotal - credits - sale.amountPaidCents);

  return (
    <div className="min-h-screen bg-cream px-6 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href="/sales" className="brand-heading text-sm text-agave hover:underline">← Back to sales</Link>
          <PrintButton />
        </div>

        <div className="rounded-lg border border-ink/10 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
          <div className="flex items-start justify-between">
            <Image src="/logo-black.png" alt="Tequila De Nada" width={170} height={101} />
            <div className="text-right">
              <div className="brand-heading text-xl text-ink">INVOICE</div>
              <div className="mt-1 font-mono text-sm">{invoiceNo}</div>
              <div className="mt-2 text-xs text-slate/80">
                Date: {dateStr(sale.date)}
                {sale.dueDate && <><br />Due: {dateStr(sale.dueDate)}</>}
              </div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="brand-heading text-[10px] tracking-widest text-slate">From</div>
              <div className="mt-1 font-medium">DNA Spirits LLC</div>
              <div className="text-slate/80">Tequila De Nada</div>
              <div className="text-slate/80">Ex-works: {sale.warehouse.name}{sale.warehouse.location ? `, ${sale.warehouse.location}` : ""}</div>
            </div>
            <div>
              <div className="brand-heading text-[10px] tracking-widest text-slate">Bill to</div>
              <div className="mt-1 font-medium">{sale.importer.name}</div>
              {sale.importer.contactName && <div className="text-slate/80">{sale.importer.contactName}</div>}
              {sale.importer.email && <div className="text-slate/80">{sale.importer.email}</div>}
            </div>
          </div>

          <table className="mt-8 w-full text-sm">
            <thead>
              <tr className="border-b border-ink/15 text-left text-xs text-slate">
                <th className="pb-2">Item</th>
                <th className="pb-2 text-right">Cases</th>
                <th className="pb-2 text-right">Price / case</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l) => (
                <tr key={l.id} className="border-b border-ink/5">
                  <td className="py-2">
                    {l.product.name} <span className="text-xs text-slate/60">({l.product.sku}, {l.product.sizeMl}ml × {l.product.bottlesPerCase})</span>
                  </td>
                  <td className="py-2 text-right">{num(l.cases)}</td>
                  <td className="py-2 text-right">{money(l.pricePerCaseCents)}</td>
                  <td className="py-2 text-right">{money(l.cases * l.pricePerCaseCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate/80">Subtotal</span><span>{money(subtotal)}</span></div>
            {credits > 0 && (
              <div className="flex justify-between"><span className="text-slate/80">Credits applied</span><span>−{money(credits)}</span></div>
            )}
            {sale.amountPaidCents > 0 && (
              <div className="flex justify-between"><span className="text-slate/80">Paid to date</span><span>−{money(sale.amountPaidCents)}</span></div>
            )}
            <div className="flex justify-between border-t border-ink/15 pt-1 font-medium">
              <span>Balance due</span><span>{money(balance)}</span>
            </div>
          </div>

          {sale.notes && <p className="mt-6 text-xs text-slate/80">{sale.notes}</p>}
          <p className="mt-8 text-center text-xs text-slate/60">
            Thank you — de nada. · Tequila De Nada · DNA Spirits LLC
          </p>
        </div>
      </div>
    </div>
  );
}
