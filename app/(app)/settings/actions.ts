"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";

export async function createUser(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 8) return;
  await db.user.create({
    data: {
      email,
      name: String(formData.get("name") ?? "").trim(),
      passwordHash: await bcrypt.hash(password, 10),
      role: ["ADMIN", "MEMBER", "BOOKKEEPER"].includes(String(formData.get("role")))
        ? String(formData.get("role"))
        : "MEMBER",
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

export async function changeOwnPassword(formData: FormData) {
  const user = await requireUser();
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return;
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });
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
