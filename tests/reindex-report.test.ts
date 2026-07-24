import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FtsIndex } from "../src/fts5.js";
import { verifyIndexedPaths } from "../src/reindex-report.js";
import { Vault } from "../src/vault.js";

/**
 * `obsidian_reindex`'s aggregate counters cannot distinguish "the watcher
 * already indexed my writes" from "the sync never saw them" — both report
 * `updated: 0`. These tests pin the per-file verification that makes the
 * difference observable.
 */

let root: string;
let vault: Vault;
let alphaMtime: number;
let betaMtime: number;

/** Minimal stand-in for the FTS5 index — only `sourceState` is consulted. */
function fakeIndex(stored: Record<string, { mtimeMs: number; nChunks: number }>): FtsIndex {
  return {
    sourceState(relPath: string) {
      const row = stored[relPath];
      return row ? { indexedAt: 0, mtimeMs: row.mtimeMs, nChunks: row.nChunks } : null;
    }
  } as unknown as FtsIndex;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "enquire-reindex-test-"));
  await fs.writeFile(path.join(root, "Alpha.md"), "alpha\n");
  await fs.writeFile(path.join(root, "Beta.md"), "beta\n");
  const now = Date.now();
  await fs.utimes(path.join(root, "Alpha.md"), new Date(now - 600_000), new Date(now - 600_000));
  await fs.utimes(path.join(root, "Beta.md"), new Date(now), new Date(now));
  vault = new Vault(root);
  const entries = await vault.listMarkdown();
  alphaMtime = entries.find((e) => e.relPath === "Alpha.md")?.mtimeMs ?? 0;
  betaMtime = entries.find((e) => e.relPath === "Beta.md")?.mtimeMs ?? 0;
});

afterAll(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("verifyIndexedPaths", () => {
  it("returns nothing when neither verify_paths nor since is given", async () => {
    const out = await verifyIndexedPaths(vault, fakeIndex({}), {});
    expect(out).toEqual([]);
  });

  it("reports in_sync when the index mtime matches disk", async () => {
    const idx = fakeIndex({ "Alpha.md": { mtimeMs: alphaMtime, nChunks: 3 } });
    const [entry] = await verifyIndexedPaths(vault, idx, { verifyPaths: ["Alpha.md"] });
    expect(entry?.in_sync).toBe(true);
    expect(entry?.indexed_chunks).toBe(3);
    expect(entry?.indexed_mtime).toBe(new Date(alphaMtime).toISOString());
  });

  it("reports in_sync:false when the index holds a stale mtime", async () => {
    const idx = fakeIndex({ "Alpha.md": { mtimeMs: alphaMtime - 5000, nChunks: 3 } });
    const [entry] = await verifyIndexedPaths(vault, idx, { verifyPaths: ["Alpha.md"] });
    expect(entry?.in_sync).toBe(false);
    expect(entry?.mtime).toBe(new Date(alphaMtime).toISOString());
  });

  it("reports a note the index has never seen, rather than omitting it", async () => {
    const [entry] = await verifyIndexedPaths(vault, fakeIndex({}), { verifyPaths: ["Alpha.md"] });
    expect(entry?.indexed_mtime).toBeNull();
    expect(entry?.indexed_chunks).toBeNull();
    expect(entry?.in_sync).toBe(false);
  });

  it("tolerates a missing .md extension", async () => {
    const idx = fakeIndex({ "Alpha.md": { mtimeMs: alphaMtime, nChunks: 1 } });
    const [entry] = await verifyIndexedPaths(vault, idx, { verifyPaths: ["Alpha"] });
    expect(entry?.path).toBe("Alpha.md");
    expect(entry?.in_sync).toBe(true);
  });

  it("surfaces a typo'd path instead of silently dropping it", async () => {
    const [entry] = await verifyIndexedPaths(vault, fakeIndex({}), { verifyPaths: ["Nope.md"] });
    expect(entry?.path).toBe("Nope.md");
    expect(entry?.mtime).toBeNull();
    expect(entry?.in_sync).toBe(false);
  });

  it("selects by `since` and orders newest-first", async () => {
    const idx = fakeIndex({
      "Alpha.md": { mtimeMs: alphaMtime, nChunks: 1 },
      "Beta.md": { mtimeMs: betaMtime, nChunks: 1 }
    });
    const out = await verifyIndexedPaths(vault, idx, { sinceMs: alphaMtime - 1000 });
    expect(out.map((e) => e.path)).toEqual(["Beta.md", "Alpha.md"]);
  });

  it("excludes notes older than `since`", async () => {
    const idx = fakeIndex({ "Beta.md": { mtimeMs: betaMtime, nChunks: 1 } });
    const out = await verifyIndexedPaths(vault, idx, { sinceMs: betaMtime - 1000 });
    expect(out.map((e) => e.path)).toEqual(["Beta.md"]);
  });

  it("does not report the same note twice when both selectors match it", async () => {
    const idx = fakeIndex({ "Beta.md": { mtimeMs: betaMtime, nChunks: 1 } });
    const out = await verifyIndexedPaths(vault, idx, {
      sinceMs: betaMtime - 1000,
      verifyPaths: ["Beta.md"]
    });
    expect(out).toHaveLength(1);
  });
});
