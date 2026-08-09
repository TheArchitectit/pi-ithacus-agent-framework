/**
 * provider-resolver.ts — resolves which pi provider owns a model id.
 *
 * Pure + pi-agnostic (no fs, no network — PREVENT-ITH-004). The extension
 * layer (extensions/ithacus-provider-config.ts) loads the pi-setup config
 * files (`~/.pi/agent/models.json` + `settings.json`) into a `PiSetupConfig`
 * object and hands it here. This keeps src/ fully unit-testable.
 *
 * Problem this solves: ithacus's bundled agent markdown uses *bare* model
 * ids (`claude-haiku-4-5`). `spawnAgent` passes them to `pi --model <id>`,
 * which resolves bare ids to the `anthropic` provider by default. Environments
 * that configured a different provider via pi-setup (e.g. `plexus`) hit
 * "No API key found for anthropic". This resolver maps a bare id back to the
 * configured provider that actually owns it, so the child pi subprocess can be
 * spawned with an explicit `--provider <name>`.
 *
 * Resolution precedence:
 *   1. provider-prefixed model (`plexus/foo`) → split, no lookup needed.
 *   2. explicit `provider` override (dispatch param).
 *   3. agent frontmatter `provider:` field.
 *   4. scan pi-setup `models.json` for the bare id:
 *        - exactly one owning provider → use it.
 *        - ambiguous (>=2) → prefer `settings.defaultProvider` if among them,
 *          else unresolved (ambiguity is a config smell the user should fix).
 *        - zero → unresolved.
 *   5. unresolved → fast-fail with a hint (caller decides: no doomed spawn).
 */

/** Subset of pi-setup's `~/.pi/agent/models.json` shape. */
export interface PiSetupProvider {
  baseUrl?: string;
  api?: string;
  models?: Array<{ id: string; name?: string }>;
}

/** Subset of pi-setup's `~/.pi/agent/settings.json` shape. */
export interface PiSetupSettings {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
}

/** Parsed pi-setup config, injected by the extension layer. */
export interface PiSetupConfig {
  providers?: Record<string, PiSetupProvider>;
  settings?: PiSetupSettings;
}

export interface ResolveProviderOpts {
  model: string;
  /** Explicit per-dispatch provider override (highest precedence after prefix). */
  explicitProvider?: string;
  /** Per-agent frontmatter `provider:` field. */
  agentProvider?: string;
  /** pi-setup config (models.json + settings.json). Optional; absence = fast-fail. */
  piConfig?: PiSetupConfig;
}

export type ProviderSource =
  | "model-prefix"
  | "explicit-param"
  | "agent-frontmatter"
  | "pi-setup-unique"
  | "pi-setup-default"
  | "unresolved";

export interface ResolvedProvider {
  /** Original model id (post-split for prefixed ids). */
  model: string;
  /** Resolved provider name, or undefined when unresolved. */
  provider?: string;
  source: ProviderSource;
  /** Present when resolved === "unresolved". Caller surfaces this to the user. */
  error?: string;
  /** Hint shown to the user on unresolved (points to /setup). */
  hint?: string;
}

const UNRESOLVED_HINT =
  "Run `/ithacus-setup` to bind a model+provider to this role, or `/setup` (pi-setup) to configure providers. You can also set a `provider:` field in the agent's markdown frontmatter or pass a `provider/model` id.";

/**
 * Resolve the provider for a model id per the precedence above. Pure.
 */
export function resolveProviderForModel(opts: ResolveProviderOpts): ResolvedProvider {
  const raw = opts.model?.trim();
  if (!raw) {
    return { model: "", source: "unresolved", error: "Empty model id.", hint: UNRESOLVED_HINT };
  }

  // 1. provider-prefixed: "plexus/claude-mythos-5" → provider=plexus, model=...
  const slashIdx = raw.indexOf("/");
  if (slashIdx > 0) {
    const provider = raw.slice(0, slashIdx);
    const model = raw.slice(slashIdx + 1);
    if (provider && model) {
      return { model, provider, source: "model-prefix" };
    }
  }

  // 2. explicit dispatch param
  if (opts.explicitProvider) {
    return { model: raw, provider: opts.explicitProvider, source: "explicit-param" };
  }

  // 3. agent frontmatter provider
  if (opts.agentProvider) {
    return { model: raw, provider: opts.agentProvider, source: "agent-frontmatter" };
  }

  // 4. scan pi-setup config for the bare id
  const providers = opts.piConfig?.providers ?? {};
  const owners: string[] = [];
  for (const [name, pv] of Object.entries(providers)) {
    if (pv?.models?.some((m) => m?.id === raw)) {
      owners.push(name);
    }
  }

  if (owners.length === 1) {
    return { model: raw, provider: owners[0], source: "pi-setup-unique" };
  }

  if (owners.length >= 2) {
    const defaultP = opts.piConfig?.settings?.defaultProvider;
    if (defaultP && owners.includes(defaultP)) {
      return { model: raw, provider: defaultP, source: "pi-setup-default" };
    }
    return {
      model: raw,
      source: "unresolved",
      error: `Model "${raw}" is ambiguous — owned by ${owners.map((o) => `"${o}"`).join(", ")}. Set a default provider in /setup or pin the provider in the agent's frontmatter.`,
      hint: UNRESOLVED_HINT,
    };
  }

  // 5. zero owners — but a defaultProvider is configured in pi-setup. This is
  // the "just works" path: the user ran /setup and picked a default provider
  // (and possibly a default model). Rather than fast-fail on the bundled
  // agent's bare model id (which may not exist under their provider), fall
  // back to the session default. Prefer settings.defaultModel when set
  // (overrides the agent's bare id); otherwise use the bare id with the
  // default provider and let pi resolve it.
  const defaultP = opts.piConfig?.settings?.defaultProvider;
  if (defaultP) {
    const defaultM = opts.piConfig?.settings?.defaultModel;
    return {
      model: defaultM ?? raw,
      provider: defaultP,
      source: "settings-default-fallback",
    };
  }

  // 6. truly unresolved — no provider owns the model AND no default provider
  // is configured. Fast-fail with a hint (do not spawn a doomed subprocess).
  const hasAnyConfig = Object.keys(providers).length > 0;
  return {
    model: raw,
    source: "unresolved",
    error: hasAnyConfig
      ? `No configured provider owns model "${raw}", and no default provider is set in /setup. It is not in any provider's model list in ~/.pi/agent/models.json.`
      : `No providers configured. Model "${raw}" cannot be resolved (run /setup first).`,
    hint: UNRESOLVED_HINT,
  };
}
