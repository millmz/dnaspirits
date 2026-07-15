"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { isRateLimited, recordHit, clearHits } from "@/lib/rate-limit";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_PER_ACCOUNT = 5; // failed attempts per account+IP
const MAX_PER_IP = 20; // failed attempts per IP across all accounts

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
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
    redirect("/login?error=1");
  }

  clearHits(accountKey);
  await createSession(user.id, user.passwordHash);
  redirect(user.role === "BOOKKEEPER" ? "/accounting" : "/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
