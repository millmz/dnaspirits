"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, requireUser } from "@/lib/auth";
import { generateTotpSecret, verifyTotp } from "@/lib/totp";
import { seal, unseal } from "@/lib/crypto";

const back = (msg: string, ok = false): never =>
  redirect(`/security?${ok ? "ok" : "err"}=${encodeURIComponent(msg)}`);

/** Begin 2FA enrollment: mint a secret; it only counts once a code confirms it. */
export async function start2fa() {
  const user = await requireUser();
  if (user.totpEnabled) redirect("/security");
  await db.user.update({
    where: { id: user.id },
    data: { totpSecret: seal(generateTotpSecret()), totpEnabled: false },
  });
  revalidatePath("/security");
}

export async function cancel2fa() {
  const user = await requireUser();
  if (user.totpEnabled) redirect("/security");
  await db.user.update({ where: { id: user.id }, data: { totpSecret: "" } });
  revalidatePath("/security");
}

/** Prove the authenticator has the secret, then switch 2FA on. */
export async function confirm2fa(formData: FormData) {
  const user = await requireUser();
  if (!user.totpSecret || user.totpEnabled) redirect("/security");
  const code = String(formData.get("code") ?? "");
  if (!verifyTotp(unseal(user.totpSecret), code)) {
    back("That code didn't match — enter the current 6-digit code from your app.");
  }
  await db.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  back("Two-factor authentication is on. You'll be asked for a code at every sign-in.", true);
}

/** Turning 2FA off requires a valid current code (protects a hijacked session). */
export async function disable2fa(formData: FormData) {
  const user = await requireUser();
  if (!user.totpEnabled || !user.totpSecret) redirect("/security");
  const code = String(formData.get("code") ?? "");
  if (!verifyTotp(unseal(user.totpSecret), code)) {
    back("To turn 2FA off, enter the current code from your authenticator app.");
  }
  await db.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: "" } });
  back("Two-factor authentication is off.", true);
}

/** Password change — requires the current password, signs out other sessions. */
export async function changeMyPassword(formData: FormData) {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (!(await bcrypt.compare(current, user.passwordHash))) {
    back("Current password is incorrect.");
  }
  if (next.length < 12) back("New password must be at least 12 characters.");
  if (next === current) back("Pick a different password than the current one.");

  const passwordHash = await bcrypt.hash(next, 12);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  // other sessions die with the old password-version claim; keep this one alive
  await createSession({ ...user, passwordHash });
  back("Password updated. Every other session was signed out.", true);
}

/** Invalidate every session for this account (including stolen cookies). */
export async function signOutEverywhere() {
  const user = await requireUser();
  const updated = await db.user.update({
    where: { id: user.id },
    data: { sessionVersion: { increment: 1 } },
  });
  await createSession(updated);
  back("Signed out on every other device.", true);
}
