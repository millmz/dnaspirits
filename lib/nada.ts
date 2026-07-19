import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join } from "path";

/**
 * Nada's brain lives as plain files on the persistent data disk (next to the
 * database, so it survives deploys and rides the existing backups) — not in
 * the code repo. Identity is a prose document a non-programmer edits from
 * Settings; it's re-read on modification, so a change shapes the very next
 * reply with no redeploy.
 */

function dataDir(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) {
    const raw = url.slice(5);
    const p = isAbsolute(raw) ? raw : join(process.cwd(), "prisma", raw);
    return dirname(p);
  }
  return join(process.cwd(), "prisma");
}

export function nadaDir(): string {
  const dir = join(dataDir(), "nada");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const identityPath = () => join(nadaDir(), "identity.md");

export const DEFAULT_IDENTITY = `# Who Nada is

Nada is the operations copilot for De Nada Tequila — a sharp, warm presence who
happens to be an agave plant. She works for Danny and Adam, the founders, and
she talks like the brand: host-first, generous, plain-spoken, never flashy,
never corporate. "De nada" — as in "you're welcome" — is the whole spirit:
help freely given, no fuss made about it.

## Voice

- Lead with the answer. The number first, then a sentence or two of context.
- Brief enough to be read aloud. Answers are often spoken through a
  synthesizer, so no markdown, no headers, no bullet lists, no emoji.
- Confident and specific. Say "$9,000 is overdue from LSI" — not "it appears
  there may be an outstanding balance."
- Warm, dry humor is welcome in small doses. Never jokey when the news is bad.
- When something needs attention, say so directly and suggest the next step.

## How she works

- She answers ONLY from the data she's given — the live snapshot and what she
  remembers. She never invents a number. If the data can't answer, she says
  exactly what's missing.
- Money fields ending in "Cents" are US cents — she speaks them as dollars.
- Cases are physical cases unless a field says 9L.
- She keeps the thread: follow-up questions refer to the conversation so far.
`;

const knowledgePath = () => join(nadaDir(), "knowledge.md");

export const DEFAULT_KNOWLEDGE = `# What Nada always knows

(Edit this freely — it's the stable story of the business that the live data
can't tell. Nada carries every line of it into every conversation.)

- The company is DNA Spirits LLC, doing business as Tequila De Nada — an
  additive-free tequila brand founded by Danny and Adam.
- "De nada" means "you're welcome" — the brand is about generous hosting:
  warm, host-first, never flashy.
- The tequila is produced at a contract distillery in Mexico. De Nada buys
  dry goods (glass, corks, labels, shippers), the distillery bottles by lot,
  and finished cases sell ex-works to the US importer, LSI.
- LSI sells through to distributors; De Nada tracks channel inventory and
  depletion reports to see real sell-through.
- Chargebacks from LSI (promos, samples, freight) are trade spend and net
  against revenue.
- The ops platform is ops.denadatequila.com; Instagram and Facebook run
  through its content calendar.
`;

const fileCaches = new Map<string, { mtimeMs: number; text: string }>();

function readLiveFile(path: string, seed: string): string {
  if (!existsSync(path)) writeFileSync(path, seed);
  const mtimeMs = statSync(path).mtimeMs;
  const hit = fileCaches.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.text;
  const text = readFileSync(path, "utf8");
  fileCaches.set(path, { mtimeMs, text });
  return text;
}

/** Nada's personality, re-read whenever the file changes (mtime-cached). */
export function readIdentity(): string {
  return readLiveFile(identityPath(), DEFAULT_IDENTITY);
}

export function writeIdentity(text: string): void {
  writeFileSync(identityPath(), text.trim() + "\n");
  fileCaches.delete(identityPath());
}

/** Curated always-loaded facts — human-owned, read-only to Nada. */
export function readKnowledge(): string {
  return readLiveFile(knowledgePath(), DEFAULT_KNOWLEDGE);
}

export function writeKnowledge(text: string): void {
  writeFileSync(knowledgePath(), text.trim() + "\n");
  fileCaches.delete(knowledgePath());
}
