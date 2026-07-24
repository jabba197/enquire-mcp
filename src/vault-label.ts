/**
 * Deployment-identity labelling for registered tools.
 *
 * One enquire process serves ONE vault, but every process registers the same
 * tool names. A client connected to a personal AND a work vault therefore sees
 * two identical `obsidian_search` entries whose only discriminator is whatever
 * server prefix its UI happens to render — and tool-search results and
 * truncated listings routinely drop that prefix, which turns "read the wrong
 * vault" into a realistic mistake rather than a theoretical one. Prefixing the
 * description (and suffixing the display title) puts the vault inside the text
 * the client actually matches on and shows.
 *
 * Leaf module (no internal imports) so it can be unit-tested directly —
 * `server.ts` is off-limits to test value-imports per the Class-A
 * `no-internal-imports` invariant.
 *
 * @module
 */

/**
 * Resolve the vault label for this process. The CLI flag wins; the env var is
 * the container-friendly path. Returns `""` when unset (labelling disabled).
 *
 * @param cliValue - Value of `--vault-label`, if the flag was passed.
 * @param env - Environment to read `ENQUIRE_VAULT_LABEL` from.
 * @returns Trimmed label, or `""` when no label is configured.
 * @example
 * ```ts
 * resolveVaultLabel(undefined, { ENQUIRE_VAULT_LABEL: "QVC (work)" }); // → "QVC (work)"
 * ```
 */
export function resolveVaultLabel(cliValue: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return (cliValue ?? env.ENQUIRE_VAULT_LABEL ?? "").trim();
}

/**
 * Prefix a `server.registerTool()` config object with the vault label.
 *
 * `rest` is the tail of the `registerTool(name, config, handler)` call —
 * `[config, handler]`. Only the config's user-visible strings are rewritten
 * (`description`, `title`, `annotations.title`); the schema and handler pass
 * through untouched, the input object is never mutated, and a call shaped
 * differently than expected is returned verbatim rather than mangled.
 *
 * @param rest - Arguments after the tool name, i.e. `[config, handler]`.
 * @param vaultLabel - Non-empty label to stamp on.
 * @returns A new argument list with the labelled config, or `rest` unchanged
 *   when the first argument is not a config object.
 * @example
 * ```ts
 * labelToolConfig([{ description: "Search." }, handler], "Personal");
 * // → [{ description: "[Vault: Personal] Search." }, handler]
 * ```
 */
export function labelToolConfig(rest: unknown[], vaultLabel: string): unknown[] {
  const [config, ...tail] = rest;
  if (!config || typeof config !== "object" || Array.isArray(config)) return rest;
  const cfg = config as {
    title?: unknown;
    description?: unknown;
    annotations?: Record<string, unknown>;
  };
  const labelled: Record<string, unknown> = { ...(config as Record<string, unknown>) };
  if (typeof cfg.description === "string") {
    labelled.description = `[Vault: ${vaultLabel}] ${cfg.description}`;
  }
  if (typeof cfg.title === "string") {
    labelled.title = `${cfg.title} — ${vaultLabel}`;
  }
  if (cfg.annotations && typeof cfg.annotations === "object" && typeof cfg.annotations.title === "string") {
    labelled.annotations = { ...cfg.annotations, title: `${cfg.annotations.title} — ${vaultLabel}` };
  }
  return [labelled, ...tail];
}
