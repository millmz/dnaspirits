"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toCents, toDate } from "@/lib/format";

export async function createExpense(formData: FormData) {
  await requireUser();
  await db.expense.create({
    data: {
      date: toDate(formData.get("date") as string),
      vendor: String(formData.get("vendor") ?? "").trim(),
      category: String(formData.get("category") ?? "OTHER"),
      amountCents: toCents(formData.get("amount") as string),
      notes: String(formData.get("notes") ?? "").trim(),
    },
  });
  revalidatePath("/accounting");
}

export async function deleteExpense(formData: FormData) {
  await requireUser();
  await db.expense.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/accounting");
}
