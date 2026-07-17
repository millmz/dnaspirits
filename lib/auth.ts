import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";

const COOKIE_NAME = "denada_session";
const PRE_COOKIE_NAME = "denada_preauth";
const SESSION_DAYS = 7;

const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    // Never run production on a guessable fallback secret.
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET must be set (>=16 chars) in production");
    }
    return new TextEncoder().encode("denada-dev-secret");
  }
  return new TextEncoder().encode(s);
};

/**
 * The session token carries a version claim built from the password hash
 * (tail of the bcrypt hash) and the account's sessionVersion counter.
 * Changing a password OR bumping sessionVersion ("sign out everywhere")
 * rotates the claim, which invalidates every other session immediately.
 */
type SessionUser = { id: string; passwordHash: string; sessionVersion: number };
const sessionClaim = (u: SessionUser) => `${u.passwordHash.slice(-16)}.${u.sessionVersion}`;

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ sub: user.id, ver: sessionClaim(user) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await db.user.findUnique({ where: { id: payload.sub } });
    if (!user) return null;
    if (payload.ver !== sessionClaim(user)) return null; // password changed / signed out everywhere
    return user;
  } catch {
    return null;
  }
}

/**
 * Half-signed-in state between the password check and the 2FA code check.
 * Short-lived and only good for the /login/verify step — it never grants
 * access to the app itself.
 */
export async function createPreAuth(userId: string) {
  const token = await new SignJWT({ sub: userId, stage: "2fa" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret());
  const jar = await cookies();
  jar.set(PRE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 5 * 60,
    path: "/",
  });
}

export async function readPreAuth(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(PRE_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.stage !== "2fa" || !payload.sub) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export async function clearPreAuth() {
  const jar = await cookies();
  jar.delete(PRE_COOKIE_NAME);
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // temp/admin-set passwords must be rotated before using the app
  if (user.mustChangePassword) redirect("/password");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}

/** Operations pages: bookkeepers are scoped to Finance only. */
export async function requireOps() {
  const user = await requireUser();
  if (user.role === "BOOKKEEPER") redirect("/accounting");
  return user;
}
