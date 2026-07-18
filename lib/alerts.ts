import { db } from "./db";
import { getComponentStock } from "./inventory";
import { getOpenReceivables } from "./receivables";
import { money, num } from "./format";
import { emailEnabled, sendEmail, emailShell } from "./email";
import { getSetting, setSetting } from "./settings";
import { offsiteConfigured, lastOffsiteStatus, diskUsage } from "./offsite";

export type Alert = {
  severity: "red" | "amber";
  area: string;
  message: string;
  href: string;
};

/** Everything that currently needs a human's attention, across the platform. */
export async function computeAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = new Date();

  const failedPosts = await db.socialPost.findMany({
    where: { publishError: { not: "" } },
    select: { title: true },
    take: 5,
  });
  for (const p of failedPosts) {
    alerts.push({ severity: "red", area: "Content", message: `Publish failed: "${p.title}" — fix and retry`, href: "/content" });
  }

  const { items } = await getOpenReceivables();
  const overdue = items.filter((r) => r.overdue);
  if (overdue.length > 0) {
    const total = overdue.reduce((a, r) => a + r.netDueCents, 0);
    alerts.push({
      severity: "red",
      area: "Finance",
      message: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"} totaling ${money(total)}`,
      href: "/accounting",
    });
  }

  const in30d = new Date(now.getTime() + 30 * 86_400_000);
  const legal = await db.legalRecord.findMany({
    where: { status: "ACTIVE", dueDate: { not: null, lte: in30d } },
    orderBy: { dueDate: "asc" },
    take: 5,
  });
  for (const l of legal) {
    const expired = l.dueDate! < now;
    alerts.push({
      severity: expired ? "red" : "amber",
      area: "Legal",
      message: `${l.title} ${expired ? "EXPIRED" : `due ${l.dueDate!.toISOString().slice(0, 10)}`}`,
      href: "/legal",
    });
  }

  const [components, componentStock] = await Promise.all([
    db.component.findMany({ where: { active: true, reorderPoint: { gt: 0 } } }),
    getComponentStock(),
  ]);
  const low = components.filter((c) => (componentStock.get(c.id) ?? 0) < c.reorderPoint);
  for (const c of low.slice(0, 5)) {
    alerts.push({
      severity: "amber",
      area: "Supply",
      message: `${c.name} low: ${num(Math.round(componentStock.get(c.id) ?? 0))} on hand (reorder at ${num(c.reorderPoint)}, ${c.leadTimeDays}-day lead)`,
      href: "/production/plan",
    });
  }

  const disk = diskUsage();
  if (disk && disk.usedPct >= 85) {
    alerts.push({ severity: "red", area: "System", message: `Data disk ${disk.usedPct}% full`, href: "/settings" });
  }
  if (!offsiteConfigured()) {
    alerts.push({ severity: "amber", area: "System", message: "Offsite backups are OFF — data lives on one disk", href: "/settings" });
  } else {
    const st = lastOffsiteStatus();
    if (st && (!st.snapshot || st.errors.length > 0)) {
      alerts.push({ severity: "amber", area: "System", message: "Last offsite backup had errors — check logs", href: "/settings" });
    }
  }

  try {
    const qbo = await db.qboConnection.findFirst();
    if (qbo?.refreshExpiresAt) {
      const days = Math.floor((qbo.refreshExpiresAt.getTime() - now.getTime()) / 86_400_000);
      if (days <= 21) {
        alerts.push({
          severity: days <= 0 ? "red" : "amber",
          area: "Finance",
          message: days <= 0 ? "QuickBooks connection expired — reconnect" : `QuickBooks connection expires in ${days} days`,
          href: "/accounting",
        });
      }
    }
  } catch {
    // table may not exist on fresh installs — never block alerts on it
  }

  return alerts;
}

const alertsHtml = (alerts: Alert[]) =>
  `<ul style="padding-left:18px;line-height:1.7;color:#231F20;font-size:14px">` +
  alerts
    .map(
      (a) =>
        `<li><span style="color:${a.severity === "red" ? "#b3402a" : "#a06a1f"};font-weight:bold">[${a.area}]</span> ${a.message}</li>`
    )
    .join("") +
  `</ul>`;

async function buildDigestHtml(alerts: Alert[]): Promise<string> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const in7d = new Date(now.getTime() + 7 * 86_400_000);

  const [{ totalNetCents: arTotal, aging }, upcoming, recentMetrics] = await Promise.all([
    getOpenReceivables(),
    db.socialPost.count({ where: { date: { gte: now, lte: in7d }, status: { not: "POSTED" }, unscheduled: false } }),
    db.postMetric.findMany({ where: { fetchedAt: { gte: weekAgo } }, select: { views: true, reach: true } }),
  ]);
  const views = recentMetrics.reduce((a, m) => a + m.views, 0);

  const stat = (label: string, value: string) =>
    `<td style="padding:10px 14px;border:1px solid rgba(35,31,32,.08);border-radius:6px"><div style="font-size:11px;color:#888">${label}</div><div style="font-size:18px;color:#231F20;font-weight:bold">${value}</div></td>`;

  return (
    `<table style="border-collapse:separate;border-spacing:6px;margin-bottom:16px"><tr>` +
    stat("Receivables open", money(arTotal)) +
    stat("Overdue", money(aging.d31to60 + aging.d61to90 + aging.d90plus)) +
    stat("Posts scheduled (7d)", String(upcoming)) +
    stat("Content views (7d snapshots)", num(views)) +
    `</tr></table>` +
    (alerts.length
      ? `<h3 style="font-size:14px;color:#231F20;margin:12px 0 4px">Needs attention</h3>${alertsHtml(alerts)}`
      : `<p style="color:#018769;font-size:14px">Nothing needs attention. Enjoy the week.</p>`)
  );
}

/**
 * Hourly worker: after 8am server-local, send at most one "needs attention"
 * email per day (only when there's something to say) and the Monday digest.
 */
export async function runAlertWorker(): Promise<void> {
  if (!emailEnabled()) return;
  const now = new Date();
  if (now.getHours() < 8) return;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const alerts = await computeAlerts();

  if ((await getSetting("alert-last-daily")) !== today) {
    await setSetting("alert-last-daily", today);
    if (alerts.length > 0) {
      const r = await sendEmail(
        `De Nada Ops: ${alerts.length} thing${alerts.length === 1 ? "" : "s"} need attention`,
        emailShell("Needs attention", alertsHtml(alerts))
      );
      if (!r.ok) console.error("alerts: daily email failed:", r.error);
    }
  }

  if (now.getDay() === 1 && (await getSetting("alert-last-digest")) !== today) {
    await setSetting("alert-last-digest", today);
    const r = await sendEmail("De Nada Ops: weekly digest", emailShell("Your week at a glance", await buildDigestHtml(alerts)));
    if (!r.ok) console.error("alerts: digest email failed:", r.error);
  }
}

/** Settings-page test hook: send a real digest right now. */
export async function sendTestDigest(): Promise<{ ok: boolean; error?: string }> {
  const alerts = await computeAlerts();
  return sendEmail("De Nada Ops: test digest", emailShell("Test digest", await buildDigestHtml(alerts)));
}
