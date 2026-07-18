import { apiOpsUser } from "@/lib/api-auth";
import { generateCaptions } from "@/lib/ai-captions";

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_B64 = 6 * 1024 * 1024; // client downscales to ~1024px, this is generous

/** AI caption options for the composer: { brief, image?: { data, mime } }. */
export async function POST(req: Request) {
  const auth = await apiOpsUser(req);
  if (!auth.ok) return auth.res;

  let body: { brief?: unknown; image?: { data?: unknown; mime?: unknown } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Bad request body." }, { status: 400 });
  }

  const brief = String(body.brief ?? "").slice(0, 4000);
  let image: { data: string; mime: string } | undefined;
  if (body.image?.data) {
    const data = String(body.image.data);
    const mime = String(body.image.mime ?? "");
    if (!IMAGE_MIMES.has(mime)) return Response.json({ ok: false, error: "Unsupported image type." }, { status: 400 });
    if (data.length > MAX_IMAGE_B64) return Response.json({ ok: false, error: "Image too large for AI — it should have been downscaled." }, { status: 400 });
    image = { data, mime };
  }
  if (!brief.trim() && !image) {
    return Response.json({ ok: false, error: "Give the AI a title, notes, or a photo to work from." }, { status: 400 });
  }

  const r = await generateCaptions(brief, image);
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
