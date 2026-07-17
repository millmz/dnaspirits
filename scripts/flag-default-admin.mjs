// One-time safety net: if the seeded admin account is still using the
// well-known seed password, force a rotation on next login. Never blocks
// startup — any error is logged and swallowed.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
try {
  const admin = await db.user.findUnique({ where: { email: "admin@denada.com" } });
  if (admin && !admin.mustChangePassword) {
    const stillDefault = await bcrypt.compare("denada123", admin.passwordHash);
    if (stillDefault) {
      await db.user.update({
        where: { id: admin.id },
        data: { mustChangePassword: true },
      });
      console.log("flag-default-admin: seeded admin still on the default password — rotation forced on next login.");
    }
  }
} catch (e) {
  console.error("flag-default-admin: skipped:", e?.message ?? e);
} finally {
  await db.$disconnect();
}
