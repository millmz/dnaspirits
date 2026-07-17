import { db } from "./db";

const KEEP_DAYS = 90;

/**
 * Sign-in audit trail: every password and 2FA attempt, success or failure.
 * Failures to write must never block a login, and old rows are pruned
 * opportunistically so the table stays small.
 */
export async function recordLogin(e: {
  email: string;
  userId?: string;
  ok: boolean;
  kind: "PASSWORD" | "TWO_FACTOR";
  ip?: string;
  userAgent?: string;
}) {
  try {
    await db.loginEvent.create({
      data: {
        email: e.email.slice(0, 200),
        userId: e.userId ?? "",
        ok: e.ok,
        kind: e.kind,
        ip: (e.ip ?? "").slice(0, 100),
        userAgent: (e.userAgent ?? "").slice(0, 300),
      },
    });
    if (Math.random() < 0.05) {
      await db.loginEvent.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000) } },
      });
    }
  } catch (err) {
    console.error("audit: failed to record login event:", err);
  }
}
