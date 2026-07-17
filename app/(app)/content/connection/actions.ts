"use server";

import { requireAdmin } from "@/lib/auth";
import { exchangeForPageTokens, type PageTokenResult } from "@/lib/meta";

/** Server side of the token helper — credentials are used once, never stored. */
export async function runTokenExchange(
  _prev: PageTokenResult | null,
  formData: FormData
): Promise<PageTokenResult> {
  await requireAdmin();
  const appId = String(formData.get("appId") ?? "").trim();
  const appSecret = String(formData.get("appSecret") ?? "").trim();
  // tolerate copy artifacts: whitespace, line breaks, surrounding quotes
  const token = String(formData.get("token") ?? "").replace(/["'\s]/g, "");
  if (!appId || !appSecret || !token) {
    return { ok: false, error: "Fill in all three fields." };
  }
  return exchangeForPageTokens(appId, appSecret, token);
}
