import { apiOpsUser } from "@/lib/api-auth";
import { runNadaExtractor } from "@/lib/ask";

/** Run the long-term memory extractor now (it also runs hourly on its own). */
export async function POST(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;
  const r = await runNadaExtractor();
  return Response.json({ ok: true, ...r });
}
