import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { requireAdmin } from "@/lib/auth";
import { qboConfigured, qboAuthUrl } from "@/lib/qbo";

export async function GET() {
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
  return NextResponse.redirect(qboAuthUrl(state));
}
