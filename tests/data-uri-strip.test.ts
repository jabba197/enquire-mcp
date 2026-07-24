import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIN_STRIPPED_DATA_URI_CHARS, type NoteReadFull, readNote, stripDataUris } from "../src/tools/read.js";
import { Vault } from "../src/vault.js";

/**
 * A note that embeds a pasted screenshot carries the whole image as base64 in
 * the body. Reading it to plan an edit then costs hundreds of KB of tokens for
 * content no agent can act on. `obsidian_read_note` elides those payloads by
 * default; `include_data_uris: true` opts back in.
 */
const BIG_PAYLOAD = "A".repeat(2000);
const SMALL_PAYLOAD = "B".repeat(20);

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "enquire-datauri-test-"));
  await fs.writeFile(
    path.join(root, "Screenshot.md"),
    `---\ntags: [ui]\n---\n\nBefore.\n\n![diagram](data:image/png;base64,${BIG_PAYLOAD})\n\nAfter.\n`
  );
  await fs.writeFile(path.join(root, "Tiny.md"), `Inline ![x](data:image/gif;base64,${SMALL_PAYLOAD}) here.\n`);
  await fs.writeFile(path.join(root, "Plain.md"), "No data URIs at all.\n");
});

afterAll(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

describe("stripDataUris", () => {
  it("elides a large payload and reports how much it removed", () => {
    const out = stripDataUris(`![a](data:image/png;base64,${BIG_PAYLOAD})`);
    expect(out.count).toBe(1);
    expect(out.chars).toBe(BIG_PAYLOAD.length);
    expect(out.content).not.toContain(BIG_PAYLOAD);
    expect(out.content).toContain("data:image/png;base64,");
    expect(out.content).toContain(`${BIG_PAYLOAD.length} chars of inline data elided`);
  });

  it("leaves a payload below the threshold untouched", () => {
    const input = `![a](data:image/gif;base64,${SMALL_PAYLOAD})`;
    expect(SMALL_PAYLOAD.length).toBeLessThan(MIN_STRIPPED_DATA_URI_CHARS);
    expect(stripDataUris(input)).toEqual({ chars: 0, content: input, count: 0 });
  });

  it("stops at the markdown link terminator, keeping surrounding prose intact", () => {
    const out = stripDataUris(`before ![a](data:image/png;base64,${BIG_PAYLOAD}) after`);
    expect(out.content.startsWith("before ![a](data:image/png;base64,")).toBe(true);
    expect(out.content.endsWith(") after")).toBe(true);
  });

  it("handles several payloads in one note", () => {
    const out = stripDataUris(
      `![a](data:image/png;base64,${BIG_PAYLOAD})\n\n![b](data:image/png;base64,${BIG_PAYLOAD})`
    );
    expect(out.count).toBe(2);
    expect(out.chars).toBe(BIG_PAYLOAD.length * 2);
  });

  it("is a no-op on content with no data URIs", () => {
    const input = "# Heading\n\nOrdinary prose.";
    expect(stripDataUris(input)).toEqual({ chars: 0, content: input, count: 0 });
  });

  it("matches in linear time on an adversarial payload (no catastrophic backtracking)", () => {
    // The payload class is a single negated character class with one
    // quantifier, so a long non-terminating run must not blow up.
    const adversarial = `data:image/png;base64,${"A".repeat(200_000)}`;
    const started = process.hrtime.bigint();
    stripDataUris(adversarial);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs).toBeLessThan(500);
  });
});

describe("obsidian_read_note data-URI handling", () => {
  it("strips by default and reports the counts on the result", async () => {
    const v = new Vault(root);
    const out = (await readNote(v, { path: "Screenshot.md" })) as NoteReadFull;
    expect(out.content).not.toContain(BIG_PAYLOAD);
    expect(out.content).toContain("Before.");
    expect(out.content).toContain("After.");
    expect(out.data_uris_stripped).toBe(1);
    expect(out.data_uri_chars_stripped).toBe(BIG_PAYLOAD.length);
  });

  it("returns the raw payload with include_data_uris: true", async () => {
    const v = new Vault(root);
    const out = (await readNote(v, { include_data_uris: true, path: "Screenshot.md" })) as NoteReadFull;
    expect(out.content).toContain(BIG_PAYLOAD);
    expect(out.data_uris_stripped).toBeUndefined();
  });

  it("omits the counters entirely when nothing was stripped", async () => {
    const v = new Vault(root);
    const out = (await readNote(v, { path: "Plain.md" })) as NoteReadFull;
    expect(out.data_uris_stripped).toBeUndefined();
    expect(out.data_uri_chars_stripped).toBeUndefined();
  });
});
