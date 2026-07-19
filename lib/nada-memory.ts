import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { nadaDir } from "./nada";

/**
 * Nada's long-term memory: individual markdown files, human-readable and
 * human-editable — the files ARE the source of truth. Each has a type, a
 * one-line hook (the searchable summary), and a body that says why the fact
 * matters. Recall is keyword-scored today and built so a semantic index can
 * slot in later; any index is derived and disposable, never the only copy.
 */

export const MEMORY_TYPES = ["FACT", "PREFERENCE", "PROJECT", "POINTER"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export type Memory = {
  id: string;
  type: MemoryType;
  hook: string;
  body: string;
  taughtBy: string;
  created: string; // ISO date
};

function memDir(): string {
  const dir = join(nadaDir(), "memories");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const memPath = (id: string) => join(memDir(), `${id}.md`);

function render(m: Memory): string {
  return `---
id: ${m.id}
type: ${m.type}
hook: ${m.hook.replace(/\n/g, " ")}
taughtBy: ${m.taughtBy}
created: ${m.created}
---

${m.body.trim()}
`;
}

function parse(raw: string): Memory | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.id || !meta.hook) return null;
  const type = (MEMORY_TYPES as readonly string[]).includes(meta.type) ? (meta.type as MemoryType) : "FACT";
  return { id: meta.id, type, hook: meta.hook, body: m[2].trim(), taughtBy: meta.taughtBy ?? "", created: meta.created ?? "" };
}

let listCache: { key: string; items: Memory[] } | null = null;

/** All memories, newest first. Cached on the directory's file listing+mtimes. */
export function listMemories(): Memory[] {
  const dir = memDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const key = files.map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`).join("|");
  if (listCache && listCache.key === key) return listCache.items;
  const items: Memory[] = [];
  for (const f of files) {
    try {
      const parsed = parse(readFileSync(join(dir, f), "utf8"));
      if (parsed) items.push(parsed);
    } catch {
      // an unreadable file never blocks the rest of memory
    }
  }
  items.sort((a, b) => b.created.localeCompare(a.created));
  listCache = { key, items };
  return items;
}

const tokenize = (s: string) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);

/** 0..1 keyword overlap between two texts (used for recall and dedupe). */
function overlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

/**
 * Save a durable memory — deduped on the way in: a near-duplicate of an
 * existing hook is skipped rather than stored twice.
 */
export function saveMemory(input: {
  type: string;
  hook: string;
  body: string;
  taughtBy: string;
}): { saved: true; id: string } | { saved: false; reason: string } {
  const hook = input.hook.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 4000);
  if (!hook || !body) return { saved: false, reason: "A memory needs both a hook and a body." };
  const dupe = listMemories().find((m) => overlap(m.hook, hook) >= 0.6);
  if (dupe) return { saved: false, reason: `A similar memory already exists: "${dupe.hook}" (${dupe.id})` };
  const id = `mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const memory: Memory = {
    id,
    type: (MEMORY_TYPES as readonly string[]).includes(input.type) ? (input.type as MemoryType) : "FACT",
    hook,
    body,
    taughtBy: input.taughtBy.slice(0, 100),
    created: new Date().toISOString(),
  };
  writeFileSync(memPath(id), render(memory));
  listCache = null;
  return { saved: true, id };
}

export function deleteMemory(id: string): boolean {
  if (!/^mem_[a-z0-9]+$/.test(id)) return false;
  const p = memPath(id);
  if (!existsSync(p)) return false;
  rmSync(p, { force: true });
  listCache = null;
  return true;
}

/**
 * Recall: semantic when an embedding provider exists (none today — the hook
 * is here so it can slot in without rearchitecting), else keyword scoring.
 * Degrades, never breaks.
 */
export function recallMemories(query: string, k = 4): Memory[] {
  // future: if (embeddingsConfigured()) return semanticRecall(query, k);
  const scored = listMemories()
    .map((m) => ({ m, score: overlap(query, m.hook) * 3 + overlap(query, m.body) }))
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.m);
}
