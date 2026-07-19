"use server";

import { revalidatePath } from "next/cache";
import { requireOps } from "@/lib/auth";
import { runNewsRefresh } from "@/lib/news";

/** Pull the trade-press feeds and rebuild the industry brief right now. */
export async function refreshNews() {
  await requireOps();
  await runNewsRefresh();
  revalidatePath("/");
}
