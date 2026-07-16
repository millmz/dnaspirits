import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { qboExchangeCode, qboRedirectUri } from "@/lib/qbo";

export async function GET(req: NextRequest) {
  await requireAdmin();
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = url.searchParams.get("realmId");

  const jar = await cookies();
  const expected = jar.get("qbo_state")?.value;
  jar.delete("qbo_state");

  if (!code || !realmId || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/accounting?err=QuickBooks+connection+was+rejected", url));
  }
  try {
    // Same derivation as the connect route — token exchange must reuse the
    // exact redirect_uri sent in the auth request.
    await qboExchangeCode(code, realmId, qboRedirectUri(req));
  } catch (e) {
    console.error("qbo callback:", e);
    return NextResponse.redirect(new URL("/accounting?err=QuickBooks+token+exchange+failed", url));
  }
  return NextResponse.redirect(new URL("/accounting?qbo=connected", url));
}
