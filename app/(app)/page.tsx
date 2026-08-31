import Link from "next/link";
import { requireOps } from "@/lib/auth";
import { db } from "@/lib/db";
import { getStock } from "@/lib/inventory";
import { getMarketPosition } from "@/lib/market";
import { getOpenReceivables } from "@/lib/receivables";
import { money, num, dateStr, currentPeriod } from "@/lib/format";
import { Card, Stat, Table, Td, Badge, TierBadge, EmptyState, PageHeader } from "@/components/ui";
import { computeAlerts } from "@/lib/alerts";
import { emailEnabled } from "@/lib/email";
import { getNewsBrief } from "@/lib/news";
import { getRecentMentions, lastScan } from "@/lib/mentions";
import { refreshNews, refreshMentions } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireOps();

  const period = currentPeriod();
  const yearStart = `${period.slice(0, 4)}-01`;

  const [stock, position, ytdDep, unpaid, recentSales, recentRuns] =
    await Promise.all([
      getStock(),
      getMarketPosition(),
      db.depletion.aggregate({ where: { period: { gte: yearStart } }, _sum: { cases: true } }),
      getOpenReceivables(),
      db.exWorksSale.findMany({
        orderBy: { date: "desc" },
        take: 4,
        include: { importer: true, lines: true },
      }),
      db.productionRun.findMany({
        orderBy: { startDate: "desc" },
        take: 4,
        include: { product: true },
      }),
    ]);

  const alerts = await computeAlerts();
  const brief = await getNewsBrief();
  const [mentions, scan] = await Promise.all([getRecentMentions(8), lastScan()]);
  const fgCases = stock.reduce((a, s) => a + Math.floor(s.totalBottles / s.bottlesPerCase), 0);
  const channelCases = position.reduce((a, p) => a + p.channelCases, 0);
  const receivables = unpaid.totalNetCents;


  return (
    <div>
      <PageHeader
        label="Tequila De Nada"
        title="Dashboard"
        subtitle="From agave to account — the whole operation at a glance."
      />


      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Finished goods · MX" value={`${num(fgCases)} cases`} hint="Your stock at the distillery" />
        <Stat label="Cases in channel · US" value={`${num(Math.round(channelCases))}`} hint="Importer + distributors, latest reports" tone="agave" />
        <Stat label="Depletions · YTD" value={`${num(Math.round(ytdDep._sum.cases ?? 0))} cases`} hint="Sold through to retail" />
        <Stat
          label="Open receivables"
          value={money(receivables)}
          tone={receivables > 0 ? "reposado" : "ink"}
          hint={`${unpaid.items.length} unpaid invoice${unpaid.items.length === 1 ? "" : "s"}, net of chargeback credits`}
        />
      </div>

      {alerts.length > 0 && (
        <div className="mb-5 rounded-lg border border-burnt/25 bg-white/70 p-4">
          <div className="brand-heading mb-2 text-xs font-medium tracking-widest text-burnt">
            Needs attention ({alerts.length})
          </div>
          <ul className="space-y-1 text-sm">
            {alerts.map((a, i) => (
              <li key={i}>
                <Link href={a.href} className="group flex items-start gap-2 hover:underline">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.severity === "red" ? "bg-burnt" : "bg-reposado"}`} />
                  <span>
                    <span className="font-medium">{a.area}:</span> {a.message}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {!emailEnabled() && (
            <p className="mt-2 text-xs text-slate/70">
              Want these in your inbox? Turn on email alerts in Settings.
            </p>
          )}
        </div>
      )}

      <div className="mb-5 rounded-lg border border-ink/10 bg-white/70 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="brand-heading text-xs font-medium tracking-widest text-agave-deep">
            Industry brief · tequila &amp; spirits
          </div>
          <div className="flex items-center gap-2">
            {brief && (
              <span className="text-[10px] text-slate/60">
                updated {brief.at.slice(0, 16).replace("T", " ")} UTC
              </span>
            )}
            <form action={refreshNews}>
              <SubmitButton variant="secondary" className="!px-2.5 !py-1 !text-xs">Refresh</SubmitButton>
            </form>
          </div>
        </div>
        {!brief ? (
          <p className="text-sm text-slate/70">
            First brief lands within minutes of deploy — headlines from Shanken News Daily, The
            Spirits Business, Just Drinks and VinePair, refreshed twice a day.
          </p>
        ) : (
          <>
            {brief.summary && <p className="mb-3 text-sm leading-relaxed text-ink/90">{brief.summary}</p>}
            <ul className="space-y-1">
              {brief.items.map((n, i) => (
                <li key={i} className="text-sm">
                  <a href={n.link} target="_blank" rel="noreferrer" className="group inline-flex items-start gap-2 hover:underline">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.relevance >= 3 ? "bg-agave" : "bg-ink/25"}`} />
                    <span>
                      {n.title}
                      <span className="ml-1.5 text-[10px] text-slate/60">{n.source} · {n.date.slice(0, 10)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-slate/50">Green dots = tequila/agave-specific. Links open the source.</p>
          </>
        )}
      </div>

      <div className="mb-5 rounded-lg border border-ink/10 bg-white/70 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="brand-heading text-xs font-medium tracking-widest text-agave-deep">
            Brand watch · who&apos;s talking about De Nada
          </div>
          <div className="flex items-center gap-2">
            {scan && (
              <span className="text-[10px] text-slate/60">
                scanned {scan.at.slice(0, 16).replace("T", " ")} UTC
              </span>
            )}
            <form action={refreshMentions}>
              <SubmitButton variant="secondary" className="!px-2.5 !py-1 !text-xs">Scan now</SubmitButton>
            </form>
          </div>
        </div>
        {scan?.sources && scan.sources.length > 0 && (
          <div className="mb-2 space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
              {scan.sources.map((s) => (
                <span key={s.source} className={s.error ? "text-burnt" : "text-slate/60"}>
                  {s.source === "NEWS" ? "press" : s.source.toLowerCase()}
                  {s.error ? " · blocked" : ` · ${s.found} found`}
                </span>
              ))}
            </div>
            {scan.sources
              .filter((s) => s.fix)
              .map((s) => (
                <div key={`fix-${s.source}`} className="text-[10px] leading-relaxed text-slate/70">
                  <span className="font-medium">
                    {s.source === "NEWS" ? "Press" : s.source[0] + s.source.slice(1).toLowerCase()} needs a sign-in:
                  </span>{" "}
                  {s.fix} in the server configuration, then scan again.
                </div>
              ))}
          </div>
        )}
        {mentions.length === 0 ? (
          <p className="text-sm text-slate/70">
            Nothing found yet. The platform sweeps press, Reddit — posts and the comment threads
            under them, across the tequila and cocktail forums — and Bluesky once a day; anything
            new lands here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {mentions.map((m) => (
              <li key={m.id} className="text-sm">
                <a href={m.url} target="_blank" rel="noreferrer" className="group inline-flex items-start gap-2 hover:underline">
                  <Badge tone={m.source === "REDDIT" ? "amber" : m.source === "NEWS" ? "green" : "blue"}>
                    {m.source === "REDDIT" ? "reddit" : m.source === "NEWS" ? "press" : "bluesky"}
                  </Badge>
                  <span>
                    {m.title}
                    <span className="ml-1.5 text-[10px] text-slate/60">
                      {m.author}
                      {m.publishedAt ? ` · ${m.publishedAt.toISOString().slice(0, 10)}` : ""}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Market position">
          {position.length === 0 ? (
            <EmptyState>No products yet.</EmptyState>
          ) : (
            <Table
              headers={["Product", "Tier", "Channel", "Velocity", "Weeks"]}
              align={["left", "left", "right", "right", "right"]}
            >
              {position.map((p) => (
                <tr key={p.productId}>
                  <Td>{p.name}</Td>
                  <Td><TierBadge tier={p.tier} /></Td>
                  <Td right>{num(Math.round(p.channelCases))}</Td>
                  <Td right>{p.velocityCasesPerMonth > 0 ? num(Math.round(p.velocityCasesPerMonth * 10) / 10) : "—"}</Td>
                  <Td right className="font-medium">
                    {p.weeksOfSupply === null ? "—" : num(Math.round(p.weeksOfSupply))}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Finished goods by product">
          {stock.length === 0 ? (
            <EmptyState>
              No stock yet. <Link className="text-agave-deep underline" href="/production">Complete a production run</Link> to add bottles.
            </EmptyState>
          ) : (
            <Table headers={["SKU", "Product", "Bottles", "Cases"]} align={["left", "left", "right", "right"]}>
              {stock.map((s) => (
                <tr key={s.productId}>
                  <Td><span className="font-mono text-xs">{s.sku}</span></Td>
                  <Td>{s.name}</Td>
                  <Td right>{num(s.totalBottles)}</Td>
                  <Td right>{num(Math.floor(s.totalBottles / s.bottlesPerCase))}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Recent ex-works sales">
          {recentSales.length === 0 ? (
            <EmptyState>
              No sales yet. <Link className="text-agave-deep underline" href="/sales">Record your first ex-works sale</Link>.
            </EmptyState>
          ) : (
            <Table headers={["Date", "Importer", "Cases", "Value", "Status"]} align={["left", "left", "right", "right", "left"]}>
              {recentSales.map((s) => {
                const cases = s.lines.reduce((a, l) => a + l.cases, 0);
                const value = s.lines.reduce((a, l) => a + l.cases * l.pricePerCaseCents, 0);
                return (
                  <tr key={s.id}>
                    <Td>{dateStr(s.date)}</Td>
                    <Td>{s.importer.name}</Td>
                    <Td right>{num(cases)}</Td>
                    <Td right>{money(value)}</Td>
                    <Td>
                      {s.status === "DRAFT" ? <Badge>Draft</Badge>
                        : s.invoiceStatus === "PAID" ? <Badge tone="green">Paid</Badge>
                        : <Badge tone="amber">Unpaid</Badge>}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>

        <Card title="Recent production">
          {recentRuns.length === 0 ? (
            <EmptyState>
              No runs yet. <Link className="text-agave-deep underline" href="/production">Plan your first run</Link>.
            </EmptyState>
          ) : (
            <Table headers={["Lot", "Product", "Bottles", "Status"]} align={["left", "left", "right", "left"]}>
              {recentRuns.map((r) => (
                <tr key={r.id}>
                  <Td><span className="font-mono text-xs">{r.lotCode}</span></Td>
                  <Td>{r.product.name}</Td>
                  <Td right>{num(r.status === "COMPLETED" ? r.bottlesProduced : r.bottlesPlanned)}</Td>
                  <Td>
                    {r.status === "COMPLETED" ? <Badge tone="green">Completed</Badge>
                      : r.status === "IN_PROGRESS" ? <Badge tone="blue">In progress</Badge>
                      : <Badge>Planned</Badge>}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
