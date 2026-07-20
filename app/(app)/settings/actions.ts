"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { createSession, requireAdmin } from "@/lib/auth";

export async function createUser(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 12) return;
  await db.user.create({
    data: {
      email,
      name: String(formData.get("name") ?? "").trim(),
      passwordHash: await bcrypt.hash(password, 12),
      role: ["ADMIN", "MEMBER", "BOOKKEEPER"].includes(String(formData.get("role")))
        ? String(formData.get("role"))
        : "MEMBER",
      mustChangePassword: true, // temp password — rotated on first login
    },
  });
  revalidatePath("/settings");
}

/**
 * Admin sets a temporary password for a locked-out user. The user is forced
 * to choose their own password on next login, and all their existing
 * sessions are invalidated immediately (password-version claim rotates).
 */
export async function resetUserPassword(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const password = String(formData.get("password") ?? "");
  if (password.length < 12) return;
  await db.user.update({
    where: { id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      mustChangePassword: true,
    },
  });
  revalidatePath("/settings");
}

export async function deleteUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  if (id === admin.id) return; // can't delete yourself
  await db.user.delete({ where: { id } });
  revalidatePath("/settings");
}

/** Recovery for a lost authenticator: clears 2FA so the user can re-enroll. */
export async function resetUser2fa(formData: FormData) {
  await requireAdmin();
  await db.user.update({
    where: { id: String(formData.get("id")) },
    data: { totpEnabled: false, totpSecret: "" },
  });
  revalidatePath("/settings");
}

/** Kill every session for an account (e.g. a departing team member's devices). */
export async function forceSignOut(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id"));
  const updated = await db.user.update({
    where: { id },
    data: { sessionVersion: { increment: 1 } },
  });
  // if an admin does this to themselves, keep their current session alive
  if (id === admin.id) await createSession(updated);
  revalidatePath("/settings");
}

/** Edit Nada's always-loaded core knowledge. */
export async function saveNadaKnowledge(formData: FormData) {
  await requireAdmin();
  const text = String(formData.get("knowledge") ?? "").slice(0, 20000);
  if (!text.trim()) return;
  const { writeKnowledge } = await import("@/lib/nada");
  writeKnowledge(text);
  const { redirect } = await import("next/navigation");
  redirect("/settings?nada=saved");
}

/** Edit Nada's personality — takes effect on her very next reply. */
export async function saveNadaIdentity(formData: FormData) {
  await requireAdmin();
  const text = String(formData.get("identity") ?? "").slice(0, 20000);
  if (!text.trim()) return;
  const { writeIdentity } = await import("@/lib/nada");
  writeIdentity(text);
  const { redirect } = await import("next/navigation");
  redirect("/settings?nada=saved");
}

/** Pick Nada's spoken voice — any ElevenLabs voice ID; blank returns to the default. */
export async function saveNadaVoice(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("voice") ?? "").trim();
  const { redirect } = await import("next/navigation");
  if (id && !/^[A-Za-z0-9]{8,48}$/.test(id)) redirect("/settings?nada=badvoice");
  const { setSetting } = await import("@/lib/settings");
  await setSetting("nada-voice-id", id);
  redirect("/settings?nada=voice");
}

export async function sendTestAlertEmail() {
  await requireAdmin();
  const { sendTestDigest } = await import("@/lib/alerts");
  const r = await sendTestDigest();
  const { redirect } = await import("next/navigation");
  redirect(r.ok ? "/settings?mail=sent" : `/settings?mail=${encodeURIComponent(r.error ?? "failed")}`);
}

export async function backupNow() {
  await requireAdmin();
  const { backupDatabase } = await import("@/lib/backup");
  await backupDatabase();
  revalidatePath("/settings");
}

export async function createWarehouse(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.warehouse.create({
    data: { name, location: String(formData.get("location") ?? "").trim() },
  });
  revalidatePath("/settings");
}
