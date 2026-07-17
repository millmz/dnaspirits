import { getCurrentUser } from "./auth";

/**
 * Auth + CSRF guard for JSON/upload API routes (the content composer uses
 * these instead of giant multipart server actions, so failures come back as
 * readable JSON instead of a white screen).
 *
 * CSRF: cookie-authed POSTs must originate from our own pages. The custom
 * X-Denada header forces a CORS preflight for any cross-origin caller (which
 * same-origin policy then blocks), and when the browser sends Origin we also
 * check it against the request host.
 */
export async function apiOpsUser(req: Request): Promise<
  | { ok: true; userId: string }
  | { ok: false; res: Response }
> {
  const deny = (status: number, error: string) => ({
    ok: false as const,
    res: Response.json({ ok: false, error }, { status }),
  });

  if (req.headers.get("x-denada") !== "1") return deny(403, "Missing request header.");
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  if (origin) {
    try {
      if (new URL(origin).host !== host) return deny(403, "Cross-origin request rejected.");
    } catch {
      return deny(403, "Bad origin.");
    }
  }

  const user = await getCurrentUser();
  if (!user) return deny(401, "Your session expired — sign in again.");
  if (user.mustChangePassword) return deny(401, "Change your password first, then retry.");
  if (user.role === "BOOKKEEPER") return deny(403, "Your account can't manage content.");
  return { ok: true, userId: user.id };
}
