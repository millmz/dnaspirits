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
