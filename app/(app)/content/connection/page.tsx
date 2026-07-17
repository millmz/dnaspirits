import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { metaConfigured, metaDiagnostics } from "@/lib/meta";
import { PageHeader, Card, Badge, EmptyState } from "@/components/ui";
import { TokenHelper } from "@/components/token-helper";

export const dynamic = "force-dynamic";

/**
 * Live Meta connection check: verifies the token type, the Facebook posting
 * permission (via a hidden draft that is deleted immediately), Instagram
 * access, and the public media URL — with fix-it steps for whatever fails.
 */
export default async function ConnectionPage() {
  await requireAdmin();
  const configured = metaConfigured();
  const checks = configured ? await metaDiagnostics() : [];
  const allGood = configured && checks.every((c) => c.ok);

  return (
    <div>
      <PageHeader
        label="Marketing"
        title="Meta Connection Check"
        subtitle="Tests the Instagram/Facebook connection safely — nothing visible is ever posted."
      />

      <div className="mb-4 flex items-center gap-3">
        <Link href="/content" className="brand-heading text-sm text-agave hover:underline">← Back to calendar</Link>
        <Link href="/content/connection" className="brand-heading text-sm text-agave hover:underline">Re-run checks ⟳</Link>
      </div>

      <div className="max-w-3xl space-y-6">
        <Card title={allGood ? "All checks passed" : "Check results"}>
          {!configured ? (
            <EmptyState>
              Meta isn&apos;t connected yet — set META_ACCESS_TOKEN, META_FB_PAGE_ID, META_IG_USER_ID and
              APP_URL in Render first.
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {checks.map((c) => (
                <div key={c.label} className="flex items-start gap-3 rounded-md border border-ink/8 bg-white/60 px-3 py-2">
                  <div className="mt-0.5 shrink-0">
                    {c.ok ? <Badge tone="green">✓ OK</Badge> : <Badge tone="red">✗ Fix</Badge>}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{c.label}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-slate/80">{c.detail}</div>
                  </div>
                </div>
              ))}
              {allGood && (
                <p className="text-sm text-agave-deep">
                  Everything works — go back to the calendar and hit <span className="font-medium">Retry</span> on
                  the failed post (or publish a new one).
                </p>
              )}
            </div>
          )}
        </Card>

        {configured && !allGood && (
          <Card title="How to fix a failed check: regenerate the Page token">
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-ink/90">
              <li>
                Open <span className="font-medium">developers.facebook.com</span> → Tools →{" "}
                <span className="font-medium">Graph API Explorer</span>, pick your De Nada app (top right), and
                make sure the domain dropdown in the top bar says{" "}
                <span className="font-mono">graph.facebook.com</span> — NOT graph.instagram.com.
              </li>
              <li>
                Under <span className="font-medium">Permissions</span>, add ALL of these (type each and pick it
                from the dropdown):
                <div className="mt-1 rounded-md bg-white px-3 py-2 font-mono text-xs">
                  pages_show_list · pages_manage_posts · pages_read_engagement · business_management ·
                  instagram_basic · instagram_content_publish · instagram_manage_insights
                </div>
              </li>
              <li>
                Click <span className="font-medium">Generate Access Token</span> and approve — make sure the
                De-Nada Tequila Page AND the Instagram account are both selected in the popup.
              </li>
              <li>
                Copy the token with the <span className="font-medium">copy icon</span> next to the token box
                (don&apos;t select the text by hand — it gets cut off), then paste it into the helper below. It
                does the long-lived exchange and finds the Page token for you.
              </li>
            </ol>
          </Card>
        )}

        {configured && (
          <Card title="Page token helper">
            <TokenHelper defaultAppId="1539622081002142" />
          </Card>
        )}
      </div>
    </div>
  );
}
