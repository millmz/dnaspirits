import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { qboExchangeCode } from "@/lib/qbo";

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
    await qboExchangeCode(code, realmId);
  } catch (e) {
    console.error("qbo callback:", e);
    return NextResponse.redirect(new URL("/accounting?err=QuickBooks+token+exchange+failed", url));
  }
  return NextResponse.redirect(new URL("/accounting?qbo=connected", url));
}
