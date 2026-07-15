"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parse } from "csv-parse/sync";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { toCents, toDate, toFloat } from "@/lib/format";

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

/**
 * QuickBooks P&L upload. The bookkeeper exports a simple CSV:
 *   period, account, type, amount
 * (type = income | expense; period = YYYY-MM or any date in the month)
 * Replaces existing entries for each period found in the file, so
 * re-uploading a corrected month is safe.
 */
export async function importFinancials(formData: FormData) {
  await requireUser();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect("/accounting?err=No+file+selected");

  let records: Record<string, string>[];
  try {
    records = parse(await file.text(), {
      columns: (header: string[]) =>
        header.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")),
      skip_empty_lines: true,
      trim: true,
    });
  } catch {
    redirect("/accounting?err=Could+not+parse+CSV+file");
  }

  const pick = (row: Record<string, string>, keys: string[]) => {
    for (const k of keys) if (row[k] !== undefined && row[k] !== "") return row[k];
    return "";
  };

  const rows: { period: string; account: string; kind: string; amountCents: number }[] = [];
  const skipped: string[] = [];

  records.forEach((row, i) => {
    const line = i + 2;
    const periodRaw = pick(row, ["period", "month", "date"]);
    const account = pick(row, ["account", "account_name", "category", "line_item"]);
    const typeRaw = pick(row, ["type", "kind", "section"]).toLowerCase();
    const amount = toFloat(pick(row, ["amount", "total", "value"]));

    let period = "";
    const m = periodRaw.match(/^(\d{4})[-/](\d{1,2})/);
    if (m) period = `${m[1]}-${m[2].padStart(2, "0")}`;
    else {
      const d = new Date(periodRaw);
      if (!isNaN(d.getTime())) period = d.toISOString().slice(0, 7);
    }

    if (!period) skipped.push(`Line ${line}: unreadable period "${periodRaw || "(blank)"}"`);
    else if (!account) skipped.push(`Line ${line}: missing account`);
    else if (amount === 0) skipped.push(`Line ${line}: zero/unreadable amount`);
    else {
      rows.push({
        period,
        account,
        kind: typeRaw.startsWith("inc") || typeRaw.startsWith("rev") ? "INCOME" : "EXPENSE",
        amountCents: Math.round(Math.abs(amount) * 100),
      });
    }
  });

  if (rows.length > 0) {
    const periods = [...new Set(rows.map((r) => r.period))];
    await db.$transaction([
      db.financialEntry.deleteMany({ where: { period: { in: periods } } }),
      db.financialEntry.createMany({ data: rows }),
    ]);
  }

  revalidatePath("/accounting");
  const params = new URLSearchParams({ imported: String(rows.length) });
  if (skipped.length > 0) params.set("skipped", skipped.slice(0, 10).join(" | "));
  redirect(`/accounting?${params.toString()}`);
}
