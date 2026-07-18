import { db } from "./db";

/**
 * Recurring content series: materialize upcoming occurrences as IDEA posts
 * so the calendar prompts the team instead of sitting empty. Idempotent —
 * an occurrence within ±12h of an existing post from the same series is
 * considered already created (rescheduling a post doesn't resurrect it).
 */
export async function materializeSeries(): Promise<number> {
  const series = await db.postSeries.findMany({ where: { active: true } });
  let created = 0;
  const now = new Date();

  for (const s of series) {
    const [hh, mm] = s.time.split(":").map((v) => parseInt(v, 10));
    const daysToNext = (s.dayOfWeek - now.getDay() + 7) % 7;
    for (let w = 0; w <= Math.max(0, Math.min(s.weeksAhead, 8)); w++) {
      const d = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + daysToNext + 7 * w,
        isNaN(hh) ? 9 : hh,
        isNaN(mm) ? 0 : mm
      );
      if (d <= now) continue;
      const halfDay = 12 * 60 * 60 * 1000;
      const exists = await db.socialPost.findFirst({
        where: {
          seriesId: s.id,
          date: { gte: new Date(d.getTime() - halfDay), lte: new Date(d.getTime() + halfDay) },
        },
        select: { id: true },
      });
      if (exists) continue;
      const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      await db.socialPost.create({
        data: {
          title: (s.titleTemplate || s.name).replace("{date}", dateLabel),
          caption: s.captionTemplate,
          hashtags: s.hashtags,
          channel: s.channel,
          status: "IDEA",
          date: d,
          seriesId: s.id,
        },
      });
      created++;
    }
  }
  return created;
}
