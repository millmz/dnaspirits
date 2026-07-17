"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession, createPreAuth, readPreAuth, clearPreAuth } from "@/lib/auth";
import { isRateLimited, recordHit, clearHits } from "@/lib/rate-limit";
import { recordLogin } from "@/lib/audit";
import { verifyTotp } from "@/lib/totp";
import { unseal } from "@/lib/crypto";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_PER_ACCOUNT = 5; // failed attempts per account+IP
const MAX_PER_IP = 20; // failed attempts per IP across all accounts

async function clientInfo() {
  const hdrs = await headers();
  return {
    ip: (hdrs.get("x-forwarded-for") ?? "unknown").split(",")[0].trim(),
    userAgent: hdrs.get("user-agent") ?? "",
  };
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const { ip, userAgent } = await clientInfo();
  const accountKey = `login:${email}:${ip}`;
  const ipKey = `login-ip:${ip}`;

  if (isRateLimited(accountKey, MAX_PER_ACCOUNT, WINDOW_MS) || isRateLimited(ipKey, MAX_PER_IP, WINDOW_MS)) {
    redirect("/login?error=locked");
  }

  const user = await db.user.findUnique({ where: { email } });
  // Always run a bcrypt compare so response timing doesn't reveal whether
  // the account exists.
  const hash = user?.passwordHash ?? "$2a$10$0000000000000000000000uGZDsO3PP3q3z1qgO9tW3O1o3q3q3q3";
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) {
    recordHit(accountKey, WINDOW_MS);
    recordHit(ipKey, WINDOW_MS);
    await recordLogin({ email, userId: user?.id, ok: false, kind: "PASSWORD", ip, userAgent });
    redirect("/login?error=1");
  }

  clearHits(accountKey);
  await recordLogin({ email, userId: user.id, ok: true, kind: "PASSWORD", ip, userAgent });

  // Second factor: password alone doesn't finish the sign-in.
  if (user.totpEnabled && user.totpSecret) {
    await createPreAuth(user.id);
    redirect("/login/verify");
  }

  await createSession(user);
  redirect(user.role === "BOOKKEEPER" ? "/accounting" : "/");
}

/** Step 2 of sign-in for accounts with 2FA: check the authenticator code. */
export async function verifyLoginCode(formData: FormData) {
  const userId = await readPreAuth();
  if (!userId) redirect("/login");

  const { ip, userAgent } = await clientInfo();
  const key = `2fa:${userId}:${ip}`;
  if (isRateLimited(key, MAX_PER_ACCOUNT, WINDOW_MS)) {
    redirect("/login/verify?error=locked");
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.totpEnabled || !user.totpSecret) redirect("/login");

  const code = String(formData.get("code") ?? "");
  if (!verifyTotp(unseal(user.totpSecret), code)) {
    recordHit(key, WINDOW_MS);
    await recordLogin({ email: user.email, userId: user.id, ok: false, kind: "TWO_FACTOR", ip, userAgent });
    redirect("/login/verify?error=1");
  }

  clearHits(key);
  await clearPreAuth();
  await recordLogin({ email: user.email, userId: user.id, ok: true, kind: "TWO_FACTOR", ip, userAgent });
  await createSession(user);
  redirect(user.role === "BOOKKEEPER" ? "/accounting" : "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
