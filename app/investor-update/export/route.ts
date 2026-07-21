import { requireAdmin } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { UPDATE_SECTIONS } from "@/lib/investor-update";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The drafted letter as a Word-openable .doc — headings styled, ready to send. */
export async function GET() {
  await requireAdmin();
  const draft = await getSetting("invupd-draft");
  if (!draft) return new Response("No draft yet — write or generate one first.", { status: 404 });

  const headings = new Set<string>(UPDATE_SECTIONS.map((s) => s.title));
  const body = draft
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return "<p>&nbsp;</p>";
      if (headings.has(t)) return `<h2>${esc(t)}</h2>`;
      return `<p>${esc(t)}</p>`;
    })
    .join("\n");

  const html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<title>De Nada Tequila — Investor Update</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.5; color: #231f20; max-width: 6.5in; }
  h2 { font-family: Arial, sans-serif; font-size: 12pt; color: #016a53; margin: 18pt 0 6pt; }
  p { margin: 0 0 8pt; }
</style></head><body>${body}</body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "application/msword",
      "Content-Disposition": `attachment; filename="De-Nada-Investor-Update-${new Date().toISOString().slice(0, 10)}.doc"`,
    },
  });
}
