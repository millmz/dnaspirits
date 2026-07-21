import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/settings";
import { aggregateInvestorData, generateInvestorDraft, UPDATE_SECTIONS } from "@/lib/investor-update";
import { money, num } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/submit-button";

async function saveNotes(formData: FormData) {
  "use server";
  await requireAdmin();
  for (const s of UPDATE_SECTIONS) {
    await setSetting(`invupd-note-${s.key}`, String(formData.get(`note-${s.key}`) ?? "").slice(0, 6000));
  }
  redirect("/investor-update?saved=notes");
}

async function saveDraft(formData: FormData) {
  "use server";
  await requireAdmin();
  await setSetting("invupd-draft", String(formData.get("draft") ?? "").slice(0, 40000));
  redirect("/investor-update?saved=draft");
}

async function draftWithAi() {
  "use server";
  await requireAdmin();
  const r = await generateInvestorDraft();
  redirect(r.ok ? "/investor-update?saved=ai" : `/investor-update?err=${encodeURIComponent(r.error ?? "failed")}`);
}

const tierLabel: Record<string, string> = { BLANCO: "Blanco", REPOSADO: "Reposado", ANEJO: "Añejo", OTHER: "Other" };

/**
 * The shareholder-letter builder: every number the letter needs, aggregated
 * live; section notes for the narrative; an AI draft in Adam's voice; and a
 * print-ready letter view.
 */
export default async function InvestorUpdatePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; err?: string }>;
}) {
  await requireAdmin();
  const { saved, err } = await searchParams;
  const data = await aggregateInvestorData();
  const notes: Record<string, string> = {};
  for (const s of UPDATE_SECTIONS) notes[s.key] = await getSetting(`invupd-note-${s.key}`);
  const draft = await getSetting("invupd-draft");
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const panel = (title: string, rows: React.ReactNode) => (
    <div className="rounded-md border border-ink/10 bg-white/80 p-3">
      <div className="brand-heading mb-1.5 text-[10px] uppercase tracking-widest text-agave-deep">{title}</div>
      <div className="space-y-1 text-sm leading-relaxed text-ink/90">{rows}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-cream px-6 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href="/" className="brand-heading text-sm text-agave hover:underline">← Dashboard</Link>
          <div className="flex items-center gap-2">
            <form action={draftWithAi}>
              <SubmitButton>✨ Draft the letter for me</SubmitButton>
            </form>
            <PrintButton />
          </div>
        </div>

        {saved && (
          <div className="mb-4 rounded-md bg-agave/10 px-3 py-2 text-sm text-agave-deep print:hidden">
            {saved === "ai" ? "Draft written — review and edit below, it's your voice that ships." : "Saved."}
          </div>
        )}
        {err && <div className="mb-4 rounded-md bg-burnt/10 px-3 py-2 text-sm text-burnt print:hidden">{err}</div>}

        <div className="grid gap-6 lg:grid-cols-2 print:block">
          {/* ---- the numbers, aggregated live ---- */}
          <div className="space-y-3 print:hidden">
            <div className="brand-heading text-xs uppercase tracking-widest text-slate">The numbers — live from the platform</div>

            {panel("Growth · revenue", (
              <>
                <div>
                  Since inception: <span className="font-medium">{money(data.revenue.inceptionCents)}</span>
                </div>
                {data.revenue.byYear.map((y) => (
                  <div key={y.year}>
                    {y.year}: {money(y.revenueCents)}
                    {y.growthPct !== null && (
                      <span className={y.growthPct >= 0 ? "text-agave-deep" : "text-burnt"}>
                        {" "}({y.growthPct >= 0 ? "+" : ""}{y.growthPct}%)
                      </span>
                    )}
                    {y.isOpsYtd && <span className="text-xs text-slate/60"> · ops, books pending</span>}
                  </div>
                ))}
              </>
            ))}

            {panel(`Growth · ${new Date().getFullYear()} cases sold (ex-works)`, (
              data.volumeYtd.length === 0 ? <div className="text-slate/60">No confirmed sales yet this year.</div> : (
                <>
                  {data.volumeYtd.map((v) => (
                    <div key={v.tier}>{tierLabel[v.tier] ?? v.tier}: {num(v.cases)} cases</div>
                  ))}
                  {data.volumeBySku.some((s) => s.sizeMl === 1000) && (
                    <div className="text-xs text-slate/70">
                      incl. liter format: {data.volumeBySku.filter((s) => s.sizeMl === 1000).map((s) => `${s.name} ${num(s.cases)}`).join(", ")}
                    </div>
                  )}
                </>
              )
            ))}

            {panel("Growth · distribution", (
              <>
                {data.distribution.importer && <div>Importer: {data.distribution.importer}</div>}
                <div>{data.distribution.distributors} distributor{data.distribution.distributors === 1 ? "" : "s"} across {data.distribution.markets.length} market{data.distribution.markets.length === 1 ? "" : "s"}</div>
                <div className="text-xs text-slate/70">{data.distribution.markets.join(" · ") || "No markets recorded yet."}</div>
              </>
            ))}

            {panel("Industry update · from the daily brief", (
              !data.industry ? <div className="text-slate/60">No industry brief yet — it builds itself daily.</div> : (
                <>
                  {data.industry.summary && <div>{data.industry.summary}</div>}
                  {data.industry.headlines.map((h, i) => (
                    <div key={i} className="text-xs text-slate/80">• {h.title} <span className="text-slate/50">({h.source})</span></div>
                  ))}
                </>
              )
            ))}

            {panel("Marketing · community", (
              <>
                {data.community.platforms.length === 0 && <div className="text-slate/60">No account metrics yet.</div>}
                {data.community.platforms.map((p) => (
                  <div key={p.platform}>
                    {p.platform === "INSTAGRAM" ? "Instagram" : p.platform === "FACEBOOK" ? "Facebook" : p.platform}: {num(p.followers)} followers
                    {p.changePct !== null && (
                      <span className={p.changePct >= 0 ? "text-agave-deep" : "text-burnt"}> ({p.changePct >= 0 ? "+" : ""}{p.changePct}% vs ~3 months ago)</span>
                    )}
                  </div>
                ))}
                {data.community.topPosts.length > 0 && (
                  <div className="text-xs text-slate/70">
                    Top posts: {data.community.topPosts.map((p) => `"${p.title}" (${num(p.views)} views)`).join(" · ")}
                  </div>
                )}
              </>
            ))}

            {panel("PR · recent brand mentions", (
              data.press.length === 0 ? <div className="text-slate/60">Nothing captured by Brand Watch yet.</div> : (
                data.press.map((m, i) => (
                  <div key={i} className="text-xs">
                    <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {m.title} <span className="text-slate/50">({m.source.toLowerCase()} · {m.at})</span>
                    </a>
                  </div>
                ))
              )
            ))}

            <div className="brand-heading pt-3 text-xs uppercase tracking-widest text-slate">Your narrative, section by section</div>
            <form action={saveNotes} className="space-y-3">
              {UPDATE_SECTIONS.map((s) => (
                <div key={s.key}>
                  <div className="mb-1 text-xs font-medium text-ink/80">{s.title}</div>
                  <textarea
                    name={`note-${s.key}`}
                    rows={3}
                    defaultValue={notes[s.key]}
                    placeholder={s.hint}
                    className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <SubmitButton>Save notes</SubmitButton>
            </form>
          </div>

          {/* ---- the letter ---- */}
          <div>
            <div className="brand-heading mb-3 text-xs uppercase tracking-widest text-slate print:hidden">The letter</div>
            <div className="rounded-lg border border-ink/10 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
              <div className="flex items-start justify-between">
                <Image src="/logo-black.png" alt="Tequila De Nada" width={140} height={83} />
                <div className="text-right">
                  <div className="brand-heading text-lg text-ink">Investor Update</div>
                  <div className="text-sm text-slate/80">{today}</div>
                </div>
              </div>
              {draft ? (
                <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-ink">{draft}</p>
              ) : (
                <p className="mt-6 text-sm text-slate/50 print:hidden">
                  No draft yet. Fill in your section notes on the left, then hit &ldquo;✨ Draft the letter for
                  me&rdquo; — it writes the whole update in your voice from the live numbers and your notes.
                  Edit the result below until it sounds like you.
                </p>
              )}
              <p className="mt-8 text-center text-xs text-slate/60">Tequila De Nada · DNA Spirits LLC · de nada.</p>
            </div>

            <form action={saveDraft} className="mt-4 print:hidden">
              <textarea
                name="draft"
                rows={22}
                defaultValue={draft}
                placeholder="The drafted letter lands here — edit freely, then Save."
                className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 font-mono text-xs leading-relaxed"
              />
              <div className="mt-2 flex items-center gap-2">
                <SubmitButton>Save letter</SubmitButton>
                <a href="/investor-update/export" className="rounded-md border border-ink/15 bg-white px-4 py-2 text-sm hover:border-agave">
                  Download for Word
                </a>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
