import { describe, expect, it } from "vitest";
import { labelToolConfig, resolveVaultLabel } from "../src/vault-label.js";

/**
 * One enquire process serves ONE vault, but every process registers the same
 * tool names. A client connected to a personal AND a work vault therefore sees
 * two identical `obsidian_search` entries whose only discriminator is whatever
 * server prefix its UI renders — and tool-search results routinely drop that.
 * The vault label puts the vault inside the text the client actually matches.
 */
describe("labelToolConfig", () => {
  const config = {
    annotations: { readOnlyHint: true, title: "Search" },
    description: "Hybrid search across the vault.",
    inputSchema: {},
    title: "Search"
  };

  it("prefixes the description with the vault name", () => {
    const [labelled] = labelToolConfig([config, () => undefined], "QVC (work)") as [{ description: string }];
    expect(labelled.description).toBe("[Vault: QVC (work)] Hybrid search across the vault.");
  });

  it("suffixes the display title and the annotation title", () => {
    const [labelled] = labelToolConfig([config, () => undefined], "Personal") as [
      { annotations: { title: string }; title: string }
    ];
    expect(labelled.title).toBe("Search — Personal");
    expect(labelled.annotations.title).toBe("Search — Personal");
  });

  it("leaves the schema and handler untouched", () => {
    const handler = () => undefined;
    const rest = labelToolConfig([config, handler], "Personal");
    expect(rest).toHaveLength(2);
    expect(rest[1]).toBe(handler);
    expect((rest[0] as { inputSchema: unknown }).inputSchema).toBe(config.inputSchema);
  });

  it("does not mutate the original config", () => {
    labelToolConfig([config, () => undefined], "Personal");
    expect(config.description).toBe("Hybrid search across the vault.");
    expect(config.annotations.title).toBe("Search");
  });

  it("produces distinct descriptions for two vaults (the whole point)", () => {
    const [personal] = labelToolConfig([config, () => undefined], "Personal") as [{ description: string }];
    const [work] = labelToolConfig([config, () => undefined], "QVC (work)") as [{ description: string }];
    expect(personal.description).not.toBe(work.description);
  });

  it("returns a call it does not recognise verbatim rather than mangling it", () => {
    const odd = ["not-a-config", 42];
    expect(labelToolConfig(odd, "Personal")).toBe(odd);
  });
});

describe("resolveVaultLabel", () => {
  it("prefers the CLI flag over the env var", () => {
    expect(resolveVaultLabel("From CLI", { ENQUIRE_VAULT_LABEL: "From env" })).toBe("From CLI");
  });

  it("falls back to ENQUIRE_VAULT_LABEL (the container-friendly path)", () => {
    expect(resolveVaultLabel(undefined, { ENQUIRE_VAULT_LABEL: "QVC (work)" })).toBe("QVC (work)");
  });

  it("returns an empty string when neither is set, disabling labelling", () => {
    expect(resolveVaultLabel(undefined, {})).toBe("");
    expect(resolveVaultLabel("   ", {})).toBe("");
  });
});
