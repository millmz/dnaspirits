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

let identityCache: { mtimeMs: number; text: string } | null = null;

/** Nada's personality, re-read whenever the file changes (mtime-cached). */
export function readIdentity(): string {
  const p = identityPath();
  if (!existsSync(p)) {
    writeFileSync(p, DEFAULT_IDENTITY);
  }
  const mtimeMs = statSync(p).mtimeMs;
  if (!identityCache || identityCache.mtimeMs !== mtimeMs) {
    identityCache = { mtimeMs, text: readFileSync(p, "utf8") };
  }
  return identityCache.text;
}

export function writeIdentity(text: string): void {
  writeFileSync(identityPath(), text.trim() + "\n");
  identityCache = null;
}
