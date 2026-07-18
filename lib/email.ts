/**
 * Outbound email via Resend (https://resend.com — free tier is plenty).
 * Env:
 *   RESEND_API_KEY     — from the Resend dashboard
 *   ALERT_EMAIL_TO     — comma-separated recipients (you and Danny)
 *   ALERT_EMAIL_FROM   — optional; defaults to Resend's shared onboarding
 *                        sender, which works without domain verification
 */
export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO);
}

export function emailRecipients(): string[] {
  return (process.env.ALERT_EMAIL_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendEmail(subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  if (!emailEnabled()) return { ok: false, error: "Email is not configured (RESEND_API_KEY / ALERT_EMAIL_TO)." };
  try {
    const res = await fetch(`${process.env.RESEND_API_URL || "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.ALERT_EMAIL_FROM || "De Nada Ops <onboarding@resend.dev>",
        to: emailRecipients(),
        subject,
        html,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, error: body.message || `Resend returned ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

/** Shared shell so every email looks like the platform. */
export function emailShell(title: string, bodyHtml: string): string {
  return `<div style="font-family:Georgia,serif;background:#F3F8E4;padding:24px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;padding:28px;border:1px solid rgba(35,31,32,.1)">
    <div style="font-size:11px;letter-spacing:.3em;color:#018769;text-transform:uppercase;margin-bottom:4px">De Nada Ops</div>
    <h1 style="font-size:20px;color:#231F20;margin:0 0 16px">${title}</h1>
    ${bodyHtml}
    <p style="margin-top:24px;font-size:12px;color:#888">
      Sent by your ops platform · <a href="${process.env.APP_URL || "https://ops.denadatequila.com"}" style="color:#018769">open the dashboard</a>
    </p>
  </div>
</div>`;
}
