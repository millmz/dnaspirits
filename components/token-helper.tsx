"use client";

import { useActionState } from "react";
import { inputCls, btnCls } from "@/components/ui";
import { runTokenExchange } from "@/app/(app)/content/connection/actions";
import type { PageTokenResult } from "@/lib/meta";

/**
 * Does the two token-conversion steps (long-lived exchange + Page token
 * lookup) server-side, so nobody has to hand-assemble Graph API URLs.
 */
export function TokenHelper({ defaultAppId }: { defaultAppId: string }) {
  const [result, formAction, pending] = useActionState<PageTokenResult | null, FormData>(
    runTokenExchange,
    null
  );

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate">App ID</span>
            <input name="appId" defaultValue={defaultAppId} required className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate">
              App Secret (App Settings → Basic → Show)
            </span>
            <input name="appSecret" type="password" required className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate">
            Access token from Graph API Explorer (use the copy icon next to the token box)
          </span>
          <textarea name="token" rows={3} required className={`${inputCls} font-mono text-xs`} placeholder="EAAV…" />
        </label>
        <button disabled={pending} className={`${btnCls} disabled:cursor-not-allowed disabled:opacity-60`}>
          {pending ? "Talking to Meta…" : "Get my Page token"}
        </button>
        <p className="text-xs text-slate/70">
          Nothing you enter here is stored — it&apos;s used once to ask Meta for the Page token, then forgotten.
        </p>
      </form>

      {result && !result.ok && (
        <div className="rounded-md bg-burnt/10 px-3 py-2 text-sm text-burnt">{result.error}</div>
      )}
      {result?.ok && (
        <div className="space-y-3">
          {result.pages.map((p) => (
            <div key={p.id} className="rounded-md border border-agave/30 bg-agave/5 p-3">
              <div className="text-sm font-medium text-agave-deep">
                {p.name} <span className="font-mono text-xs text-slate/70">(Page id {p.id})</span>
              </div>
              <textarea
                readOnly
                rows={3}
                value={p.token}
                onFocus={(e) => e.currentTarget.select()}
                className={`${inputCls} mt-2 font-mono text-xs`}
              />
              <p className="mt-1 text-xs text-slate/80">
                Copy this whole value into Render → Environment → <span className="font-mono">META_ACCESS_TOKEN</span>{" "}
                and save. When the service restarts, come back and hit &ldquo;Re-run checks&rdquo;.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
