import { db } from "@/lib/db";
import { apiOpsUser } from "@/lib/api-auth";

export type SearchHit = { type: string; label: string; sub: string; href: string };

/** Global ⌘K search across every entity type on the platform. */
export async function POST(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  let body: { q?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const q = String(body.q ?? "").trim().slice(0, 100);
  if (q.length < 2) return Response.json({ ok: true, hits: [] });

  const c = { contains: q };
  const [products, components, suppliers, importers, distributors, pos, runs, sales, legal, posts] =
    await Promise.all([
      db.product.findMany({ where: { OR: [{ name: c }, { sku: c }] }, take: 4 }),
      db.component.findMany({ where: { name: c }, include: { supplier: true }, take: 4 }),
      db.supplier.findMany({ where: { name: c }, take: 3 }),
      db.importer.findMany({ where: { name: c }, take: 2 }),
      db.distributor.findMany({ where: { OR: [{ name: c }, { market: c }] }, take: 3 }),
      db.purchaseOrder.findMany({ where: { poNumber: c }, include: { supplier: true }, take: 3 }),
      db.productionRun.findMany({ where: { lotCode: c }, include: { product: true }, take: 3 }),
      db.exWorksSale.findMany({ where: { invoiceNumber: c }, include: { importer: true }, take: 3 }),
      db.legalRecord.findMany({ where: { title: c }, take: 3 }),
      db.socialPost.findMany({ where: { title: c }, orderBy: { date: "desc" }, take: 4 }),
    ]);

  const hits: SearchHit[] = [
    ...products.map((p) => ({ type: "Product", label: `${p.sku} — ${p.name}`, sub: `${p.sizeMl}ml`, href: "/products" })),
    ...components.map((x) => ({ type: "Dry good", label: x.name, sub: x.supplier?.name ?? x.category, href: `/components?movements=${x.id}` })),
    ...suppliers.map((s) => ({ type: "Supplier", label: s.name, sub: s.location, href: "/components" })),
    ...importers.map((i) => ({ type: "Importer", label: i.name, sub: i.country, href: "/partners" })),
    ...distributors.map((d) => ({ type: "Distributor", label: d.name, sub: d.market, href: "/partners" })),
    ...pos.map((po) => ({ type: "PO", label: po.poNumber, sub: `${po.supplier.name} · ${po.status}`, href: "/purchasing" })),
    ...runs.map((r) => ({ type: "Lot", label: r.lotCode, sub: `${r.product.name} · ${r.status}`, href: `/production/lot/${encodeURIComponent(r.lotCode)}` })),
    ...sales.map((s) => ({ type: "Invoice", label: s.invoiceNumber || s.id.slice(-6), sub: `${s.importer.name} · ${s.invoiceStatus}`, href: `/invoice/${s.id}` })),
    ...legal.map((l) => ({ type: "Legal", label: l.title, sub: l.status, href: "/legal" })),
    ...posts.map((p) => ({ type: "Post", label: p.title, sub: `${p.status} · ${p.date.toISOString().slice(0, 10)}`, href: "/content" })),
  ].slice(0, 15);

  return Response.json({ ok: true, hits });
}
