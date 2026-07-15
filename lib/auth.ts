import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";

const COOKIE_NAME = "denada_session";
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
 * The session token carries a password-version claim (tail of the bcrypt
 * hash). Changing a password rotates the claim, which invalidates every
 * other session for that account immediately.
 */
const passwordVersion = (passwordHash: string) => passwordHash.slice(-16);

export async function createSession(userId: string, passwordHash: string) {
  const token = await new SignJWT({ sub: userId, ver: passwordVersion(passwordHash) })
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
    if (payload.ver !== passwordVersion(user.passwordHash)) return null; // password changed
    return user;
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
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
