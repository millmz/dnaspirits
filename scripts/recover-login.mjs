/**
 * Account recovery from the server console, for when nobody can sign in and
 * the in-app admin reset is therefore unreachable.
 *
 *   node scripts/recover-login.mjs                        list accounts
 *   node scripts/recover-login.mjs you@example.com        set a temp password
 *   node scripts/recover-login.mjs you@example.com --clear-2fa   also clear 2FA
 *
 * Mirrors what the in-app admin reset does: a strong temporary password is
 * generated here (never typed on the command line, so it stays out of shell
 * history), hashed with the same bcrypt cost the app uses, and the account is
 * flagged to force a rotation on the next login. Changing the password also
 * invalidates every existing session automatically, because the session claim
 * is derived from the password hash.
 *
 * Nothing else in the database is touched.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";

const db = new PrismaClient();

// no ambiguous characters (0/O, 1/l/I) — this gets read off a screen
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const tempPassword = () =>
  Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const clear2fa = process.argv.includes("--clear-2fa");

  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  if (users.length === 0) {
    console.log("No accounts exist in this database at all.");
    console.log("Run the seed to create the first admin:  node prisma/seed.mjs");
    return;
  }

  if (!email) {
    console.log(`Accounts in this database (${users.length}):\n`);
    for (const u of users) {
      const flags = [
        u.role,
        u.mustChangePassword ? "must-change-password" : null,
        u.totpEnabled ? "2FA on" : null,
      ].filter(Boolean);
      console.log(`  ${u.email}   ${u.name || "(no name)"}   [${flags.join(", ")}]`);
    }
    console.log("\nTo reset one:  node scripts/recover-login.mjs <email>");
    console.log("Add --clear-2fa if the authenticator is also lost.");
    return;
  }

  const user = users.find((u) => u.email.toLowerCase() === email);
  if (!user) {
    console.error(`No account with the email "${email}".`);
    console.error("Run without arguments to list the real addresses.");
    process.exitCode = 1;
    return;
  }

  const password = tempPassword();
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      mustChangePassword: true,
      ...(clear2fa ? { totpEnabled: false, totpSecret: "" } : {}),
      sessionVersion: { increment: 1 }, // belt-and-braces: kill every session
    },
  });

  console.log("\n  Sign in with these, then choose your own password when prompted:\n");
  console.log(`     email     ${user.email}`);
  console.log(`     password  ${password}\n`);
  if (clear2fa) console.log("  Two-factor was cleared — set it up again from My Security.\n");
  else if (user.totpEnabled) {
    console.log("  NOTE: 2FA is still ON for this account. You'll need your authenticator");
    console.log("  code after the password. Re-run with --clear-2fa if you've lost it.\n");
  }
  console.log("  This password is temporary and must be changed at first login.");
  console.log("  All existing sessions on this account have been signed out.\n");
}

main()
  .catch((e) => {
    console.error("recover-login failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
