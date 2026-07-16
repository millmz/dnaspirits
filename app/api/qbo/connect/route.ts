import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { requireAdmin } from "@/lib/auth";
import { qboConfigured, qboAuthUrl, qboRedirectUri } from "@/lib/qbo";

export async function GET(req: NextRequest) {
  await requireAdmin();
  if (!qboConfigured()) return new NextResponse("QBO env vars not set", { status: 400 });

  const state = randomBytes(24).toString("hex");
  const jar = await cookies();
  jar.set("qbo_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  // Redirect URI is derived from the live request domain, so it matches the
  // browser's address bar (never localhost). Register this exact URL in Intuit.
  return NextResponse.redirect(qboAuthUrl(state, qboRedirectUri(req)));
}
