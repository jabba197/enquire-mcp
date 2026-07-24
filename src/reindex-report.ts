/**
 * Verification reporting for `obsidian_reindex`.
 *
 * Aggregate sync counters cannot answer the question a caller actually has
 * after a batch of writes: "is my new content searchable yet?" A report of
 * `updated: 0` is produced both when the watcher already indexed the writes and
 * when the sync never saw them, and those need opposite follow-up actions. This
 * module compares specific notes' on-disk mtime against the mtime the FTS5
 * index has stored for them, so the answer is observable rather than inferred.
 *
 * Leaf module (imports only `fts5` / `vault`, both allowlisted) so it can be
 * unit-tested directly — `server.ts` is off-limits to test value-imports per
 * the Class-A `no-internal-imports` invariant.
 *
 * @module
 */

import type { FtsIndex } from "./fts5.js";
import type { Vault } from "./vault.js";

/** Default number of paths listed per bucket in the `obsidian_reindex` report. */
export const DEFAULT_REINDEX_REPORTED_PATHS = 25;
/** Hard ceiling on `obsidian_reindex`'s `max_paths` — bounds the response size. */
export const MAX_REINDEX_REPORTED_PATHS = 500;
/** Hard ceiling on how many explicit paths `obsidian_reindex` will verify. */
export const MAX_REINDEX_VERIFY_PATHS = 200;

/** One note's on-disk state vs the state stored in the FTS5 index. */
export interface ReindexCheckedEntry {
  /** Vault-relative path as the index knows it. */
  path: string;
  /** On-disk modification time (ISO-8601), or null when the note is absent from the vault. */
  mtime: string | null;
  /** Modification time recorded in the index (ISO-8601), or null when unindexed. */
  indexed_mtime: string | null;
  /** Chunks the index currently holds for this note. */
  indexed_chunks: number | null;
  /** True when the index's recorded mtime matches the file on disk. */
  in_sync: boolean;
}

/**
 * Verify that the FTS5 index reflects the current on-disk state of specific
 * notes — the notes named in `verifyPaths`, plus everything modified at or
 * after `sinceMs`.
 *
 * Paths are matched by exact vault-relative path, tolerating a missing `.md`
 * extension. A named path that matches nothing on disk is still reported (with
 * `mtime: null`) so a typo surfaces instead of silently vanishing.
 *
 * @param vault - Vault to list notes from.
 * @param idx - FTS5 index whose stored state is compared against disk.
 * @param opts - `verifyPaths` (explicit notes) and/or `sinceMs` (epoch ms).
 * @returns One entry per checked note, `verifyPaths` first, then
 *   `sinceMs` matches newest-first. Empty when neither option is given.
 * @example
 * ```ts
 * const checked = await verifyIndexedPaths(vault, idx, { verifyPaths: ["Log.md"] });
 * checked[0]?.in_sync; // → true once the index has caught up
 * ```
 */
export async function verifyIndexedPaths(
  vault: Vault,
  idx: FtsIndex,
  opts: { sinceMs?: number; verifyPaths?: string[] }
): Promise<ReindexCheckedEntry[]> {
  const { sinceMs, verifyPaths } = opts;
  if (sinceMs === undefined && (!verifyPaths || verifyPaths.length === 0)) return [];

  const entries = await vault.listMarkdown();
  const byRelPath = new Map<string, (typeof entries)[number]>();
  for (const e of entries) byRelPath.set(e.relPath, e);

  const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
  const describe = (relPath: string, mtimeMs: number | null): ReindexCheckedEntry => {
    const stored = idx.sourceState(relPath);
    return {
      indexed_chunks: stored ? stored.nChunks : null,
      indexed_mtime: stored ? iso(stored.mtimeMs) : null,
      in_sync: stored !== null && mtimeMs !== null && stored.mtimeMs === mtimeMs,
      mtime: iso(mtimeMs),
      path: relPath
    };
  };

  const seen = new Set<string>();
  const out: ReindexCheckedEntry[] = [];

  for (const raw of verifyPaths ?? []) {
    const trimmed = raw.replace(/^\/+/, "").trim();
    const candidate = byRelPath.has(trimmed) ? trimmed : `${trimmed}.md`;
    const entry = byRelPath.get(candidate);
    const relPath = entry ? entry.relPath : trimmed;
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    out.push(describe(relPath, entry ? entry.mtimeMs : null));
  }

  if (sinceMs !== undefined) {
    const recent = entries.filter((e) => e.mtimeMs >= sinceMs).sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const e of recent) {
      if (seen.has(e.relPath)) continue;
      seen.add(e.relPath);
      out.push(describe(e.relPath, e.mtimeMs));
    }
  }

  return out;
}
