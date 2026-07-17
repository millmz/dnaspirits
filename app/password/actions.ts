"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser, createSession } from "@/lib/auth";

/**
 * Forced first-login password rotation. Requires the temporary password
 * (proves possession) and a new one meeting policy; clears the flag and
 * refreshes the session so the user lands in the app.
 */
export async function rotatePassword(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!(await bcrypt.compare(current, user.passwordHash))) {
    redirect("/password?err=Current+password+is+incorrect");
  }
  if (next.length < 12) {
    redirect("/password?err=New+password+must+be+at+least+12+characters");
  }
  if (next !== confirm) {
    redirect("/password?err=New+passwords+don%27t+match");
  }
  if (next === current) {
    redirect("/password?err=Pick+a+different+password+than+the+temporary+one");
  }

  const passwordHash = await bcrypt.hash(next, 12);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });
  await createSession({ ...user, passwordHash });
  redirect(user.role === "BOOKKEEPER" ? "/accounting" : "/");
}
