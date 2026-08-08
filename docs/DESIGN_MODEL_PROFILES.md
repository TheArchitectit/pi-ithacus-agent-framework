# Model Profile System — Interactive Model Selection

> **Status**: Design — not yet implemented  
> **Priority**: P1 (unique differentiator, no competitor does this)  
> **Created**: 2026-07-22  
> **Supersedes**: Nothing — net-new feature

---

## 1. Why This Is Different

Every existing agent framework treats model selection as **static config**:

| Framework | How model is chosen | Interactive? | Per-role? |
|---|---|---|---|
| **pi-crew** | `config.json` → single `subagentModel` | ❌ | ❌ |
| **pi-messenger** | Per-role YAML config (static) | ❌ | ✅ (config only) |
| **oh-my-pi** | Config inheritance (8 formats) | ❌ | ❌ |
| **ithacus (current)** | `resolveAgentModel` chain from session state | ❌ | ❌ |
| **ithacus (proposed)** | **Interactive prompt at task time** | ✅ | ✅ |

**The insight**: Model choice is a *task-level decision*, not a session-level config.
A code review needs thoroughness (Opus). A quick scan needs speed (Haiku). A refactoring
task needs balanced capability (Sonnet). The user should decide *per team creation*,
not per config file.

### What profiles unlock

1. **Cost control** — user sees estimated cost before committing to a model
2. **Quality tuning** — match model capability to task complexity
3. **Provider flexibility** — profiles abstract over providers; switch without config edits
4. **Local-first option** — one profile routes to a local model, zero cost
5. **Reproducibility** — same profile + same prompt = predictable behavior

---

## 2. Data Model

### 2.1 `ith_model_profiles` — Named model configurations

```sql
CREATE TABLE IF NOT EXISTS ith_model_profiles (
  profileId      TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,       -- display name: 'Speed', 'Quality', etc.
  description    TEXT NOT NULL DEFAULT '',   -- what this profile is good for
  model          TEXT NOT NULL,              -- primary model identifier
  provider       TEXT,                       -- provider override (NULL = inherit session)
  fallbackModels TEXT NOT NULL DEFAULT '[]', -- JSON array: fallback chain for this profile
  params         TEXT NOT NULL DEFAULT '{}', -- JSON: {temperature, maxTokens, timeout}
  isDefault      INTEGER NOT NULL DEFAULT 0, -- 1 = pre-selected in prompts
  scope          TEXT NOT NULL DEFAULT 'global', -- 'global' | 'repo'
  createdAt      INTEGER NOT NULL
);
```

**Design notes:**
- `name` is UNIQUE — no duplicate profile names within a store
- `scope = 'repo'` means the profile lives in `<repo>/.pi/ithacus/sqlite.db` and
  travels with the repo (per design principle P1)
- `scope = 'global'` means it lives in the global fallback store (`~/.pi/agent/extensions/ithacus/`)
- `params` is JSON to stay forward-compatible (temperature, top_p, max_tokens, etc.)
- `fallbackModels` replaces `config.fallbackModels` when a profile is active — the
  profile owns its entire fallback chain

### 2.2 `ith_team_model_assignments` — Per-role model mapping for a run

```sql
CREATE TABLE IF NOT EXISTS ith_team_model_assignments (
  runId     TEXT NOT NULL,
  role      TEXT NOT NULL,   -- AgentRole: 'Explore' | 'Plan' | 'Verification' | 'Reviewer'
  profileId TEXT NOT NULL,
  PRIMARY KEY (runId, role),
  FOREIGN KEY (profileId) REFERENCES ith_model_profiles(profileId)
);
CREATE INDEX IF NOT EXISTS ix_ith_tma_run ON ith_team_model_assignments(runId);
```

**Key property**: one row per (runId, role). If multiple agents share a role (e.g.,
mega mode has two Explore agents), they share the same profile. This is intentional —
role defines the *kind of work*, not the *specific agent*.

### 2.3 Type additions to `src/types.ts`

```typescript
export interface ModelProfile {
  profileId: string;
  name: string;
  description: string;
  model: string;
  provider: string | null;
  fallbackModels: string[];  // parsed from JSON
  params: Record<string, unknown>;  // parsed from JSON
  isDefault: boolean;
  scope: 'global' | 'repo';
  createdAt: number;
}

export interface TeamModelAssignment {
  runId: string;
  role: AgentRole;
  profileId: string;
}
```

---

## 3. Pre-seeded Profiles

On first store open (when `ith_model_profiles` is empty), seed 5 default profiles.
Seeding happens in `src/model-profiles.ts` → `seedDefaultProfiles(store)`, called
from `IthStore` constructor after schema creation.

| # | Name | Model | Provider | Fallbacks | Params | Default? |
|---|---|---|---|---|---|---|
| 1 | **Speed** | `claude-haiku-4-5-20251001` | `null` (inherit) | `["kimi", "qwen"]` | `{temperature: 0.3}` | ❌ |
| 2 | **Quality** | `claude-sonnet-4-20250514` | `null` | `["claude-haiku-4-5-20251001"]` | `{temperature: 0.5}` | ✅ |
| 3 | **Reasoning** | `claude-opus-4-20250514` | `null` | `["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"]` | `{temperature: 0.7}` | ❌ |
| 4 | **Code** | `claude-sonnet-4-20250514` | `null` | `["claude-haiku-4-5-20251001", "kimi"]` | `{temperature: 0.2, maxTokens: 16384}` | ❌ |
| 5 | **Local** | `local-model` | `custom-openai` | `[]` | `{temperature: 0.3}` | ❌ |

**Seeding logic:**
```typescript
// src/model-profiles.ts
export function seedDefaultProfiles(store: IthStore): void {
  const existing = store.db.prepare('SELECT COUNT(*) as c FROM ith_model_profiles').get() as { c: number };
  if (existing.c > 0) return;  // already seeded

  const now = Date.now();
  const defaults: Omit<ModelProfile, 'createdAt'>[] = [
    { profileId: 'speed', name: 'Speed', description: 'Fast iteration, low cost', model: 'claude-haiku-4-5-20251001', provider: null, fallbackModels: ['kimi', 'qwen'], params: { temperature: 0.3 }, isDefault: false, scope: 'global' },
    { profileId: 'quality', name: 'Quality', description: 'Thorough analysis, balanced cost', model: 'claude-sonnet-4-20250514', provider: null, fallbackModels: ['claude-haiku-4-5-20251001'], params: { temperature: 0.5 }, isDefault: true, scope: 'global' },
    { profileId: 'reasoning', name: 'Reasoning', description: 'Complex reasoning, higher cost', model: 'claude-opus-4-20250514', provider: null, fallbackModels: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'], params: { temperature: 0.7 }, isDefault: false, scope: 'global' },
    { profileId: 'code', name: 'Code', description: 'Code-optimized, low temperature', model: 'claude-sonnet-4-20250514', provider: null, fallbackModels: ['claude-haiku-4-5-20251001', 'kimi'], params: { temperature: 0.2, maxTokens: 16384 }, isDefault: false, scope: 'global' },
    { profileId: 'local', name: 'Local', description: 'Local model, zero cost', model: 'local-model', provider: 'custom-openai', fallbackModels: [], params: { temperature: 0.3 }, isDefault: false, scope: 'global' },
  ];

  for (const p of defaults) {
    store.createProfile({ ...p, createdAt: now });
  }
}
```

---

## 4. Interactive Flow

### 4.1 Team creation with profile selection

When user runs `/ithacus-team medium Refactor auth module`:

**Step 1: Show profile selection prompt**

```
Select model profile for team (medium, 3 agents):

  [1] Speed      claude-haiku-4-5-20251001   Fast iteration, low cost
  [2] Quality    claude-sonnet-4-20250514    Thorough analysis [default]
  [3] Reasoning  claude-opus-4-20250514      Complex reasoning
  [4] Code       claude-sonnet-4-20250514    Code-optimized
  [5] Local      local-model (custom-openai) Zero cost
  [C] Custom     Enter model name manually
  [P] Per-role   Assign different profiles to each role

  Selection [2]:
```

**Step 2a: Single profile selected (1-5, C)**

If user picks a number or presses Enter for default:
- All agents in the team get that profile's model
- Assignment persisted: one row per role in `ith_team_model_assignments`
- Fallback chain comes from the profile, not config

**Step 2b: Custom model (C)**

```
  Enter model name: my-custom-model
  Enter provider (or blank for session default): 
  Enter fallback models (comma-separated, or blank): 
```

Creates an ephemeral profile (scope='run', not persisted to `ith_model_profiles`).

**Step 2c: Per-role assignment (P)**

```
  Assign profiles per role:

  Explore:       [1] Speed [2] Quality [3] Reasoning [4] Code [5] Local → 1
  Plan:          [1] Speed [2] Quality [3] Reasoning [4] Code [5] Local → 3
  Verification:  [1] Speed [2] Quality [3] Reasoning [4] Code [5] Local → 2
  Reviewer:      [1] Speed [2] Quality [3] Reasoning [4] Code [5] Local → 2
```

Each role gets its own profile. Persisted as 4 rows in `ith_team_model_assignments`.

### 4.2 Implementation in `extensions/ithacus-commands.ts`

The interactive prompt uses pi's `ask` tool (via `ExtensionAPI`). This is the
pi adapter layer — `src/` stays pi-agnostic.

```typescript
// In the /ithacus-team handler, BEFORE createTeam():
async function promptProfileSelection(
  pi: ExtensionAPI,
  store: IthStore,
  mode: ModePreset,
): Promise<ModelProfile | Map<AgentRole, ModelProfile>> {
  const profiles = store.listProfiles();
  const defaultProfile = profiles.find(p => p.isDefault) || profiles[0];

  // Build numbered list
  const lines = profiles.map((p, i) =>
    `  [${i + 1}] ${p.name.padEnd(12)} ${p.model.padEnd(30)} ${p.description}${p.isDefault ? ' [default]' : ''}`
  );
  lines.push('  [C] Custom     Enter model name manually');
  lines.push('  [P] Per-role   Assign different profiles to each role');

  const answer = await pi.ask?.(
    `Select model profile for team (${mode}, ${MODE_PRESETS[mode].agents} agents):\n\n${lines.join('\n')}\n\nSelection [${profiles.indexOf(defaultProfile) + 1}]:`
  );

  // Parse answer...
  // Return ModelProfile or Map<AgentRole, ModelProfile>
}
```

**Note on `pi.ask`**: If `ExtensionAPI` does not expose `ask`, the fallback is to
check for an `--profile` flag in the command args. The interactive prompt is
the *ideal* path; the flag is the *fallback* path.

### 4.3 Non-interactive fallback

For CI/scripted usage, `/ithacus-team` accepts explicit flags:

```
/ithacus-team medium --profile speed Refactor auth module
/ithacus-team medium --profile-map Explore=Speed,Plan=Reasoning,Verification=Quality,Reviewer=Quality Fix auth bug
```

These bypass the interactive prompt entirely.

---

## 5. Resolution Chain Update

### 5.1 Current chain (src/team.ts:32)

```
resolveAgentModel(explicit, resolved):
  explicit → resolved.subagentModel → resolved.providerModel → DEFAULT_AGENT_MODEL
```

All agents share the same model. `planRun` calls `resolveAgentModel(null, resolved)`
and applies it uniformly.

### 5.2 Proposed chain

```
resolveAgentModel(explicit, resolved, profileModel?):
  profileModel → explicit → resolved.subagentModel → resolved.providerModel → DEFAULT_AGENT_MODEL
```

**Profile model takes highest precedence.** Rationale: the user *explicitly chose*
the profile at task time. This is a more deliberate decision than the session's
subagentModel or provider default.

### 5.3 Changes to `planRun`

```typescript
export function planRun(opts: {
  runId: string;
  mode: ModePreset;
  prompt: string;
  resolved: ResolvedModel;
  fallbackModels: string[];
  now: number;
  profileModels?: Map<AgentRole, string>;  // NEW: per-role profile models
}): TeamPlan {
  const preset = MODE_PRESETS[opts.mode];
  const agents: IthAgent[] = [];
  for (let i = 0; i < preset.agents; i++) {
    const role = preset.roles[i % preset.roles.length] as AgentRole;

    // Per-role model from profile, or fall back to global resolution
    const profileModel = opts.profileModels?.get(role);
    const model = profileModel
      ? qualifyForProvider(profileModel, opts.resolved.provider)
      : qualifyForProvider(
          resolveAgentModel(null, opts.resolved),
          opts.resolved.provider,
        );

    agents.push({
      id: `${opts.runId}-a${i}`,
      runId: opts.runId,
      role,
      model,
      provider: opts.resolved.provider,
      status: 'spawning',
      lastSeen: opts.now,
    });
  }
  // ... run creation unchanged
}
```

### 5.4 Changes to `buildModelChain`

```typescript
export function buildModelChain(
  explicit: string | null | undefined,
  resolved: ResolvedModel,
  fallbackModels: string[],
  profileModel?: string,        // NEW
  profileFallbacks?: string[],  // NEW: profile's own fallback chain
): string[] {
  const primary = profileModel
    ? qualifyForProvider(profileModel, resolved.provider)
    : qualifyForProvider(resolveAgentModel(explicit, resolved), resolved.provider);

  // Use profile fallbacks if provided, otherwise config fallbacks
  const effectiveFallbacks = profileFallbacks?.length
    ? profileFallbacks
    : fallbackModels;

  const chain = [primary, ...effectiveFallbacks.map(m => qualifyForProvider(m, resolved.provider))];
  return [...new Set(chain)];
}
```

### 5.5 Changes to `createTeam`

```typescript
export async function createTeam(opts: {
  pi: ExtensionAPI;
  runtime: IthRuntime;
  config: IthacusConfig;
  ctx: ExtensionContext;
  mode: ModePreset;
  prompt: string;
  resolved: ResolvedModel;
  profileAssignments?: Map<AgentRole, ModelProfile>;  // NEW
}): Promise<SpawnResult> {
  const runId = genId('run');
  const now = Date.now();

  // Build per-role model map from profile assignments
  const profileModels = new Map<AgentRole, string>();
  const profileFallbacks = new Map<AgentRole, string[]>();
  if (opts.profileAssignments) {
    for (const [role, profile] of opts.profileAssignments) {
      profileModels.set(role, profile.model);
      profileFallbacks.set(role, profile.fallbackModels);
      // Persist assignment
      opts.runtime.store.upsertAssignment({ runId, role, profileId: profile.profileId });
    }
  }

  const plan = planRun({
    runId, mode: opts.mode, prompt: opts.prompt,
    resolved: opts.resolved, fallbackModels: opts.config.fallbackModels,
    now, profileModels,  // NEW
  });

  // ... rest unchanged, but buildModelChain now receives profile-specific fallbacks
}
```

---

## 6. Files to Create / Modify

### 6.1 New files

| File | Purpose | Lines (est.) |
|---|---|---|
| `src/model-profiles.ts` | Profile CRUD, resolution helpers, default seeding | ~120 |
| `docs/DESIGN_MODEL_PROFILES.md` | This design doc | ~400 |

### 6.2 Modified files

| File | Changes | Scope |
|---|---|---|
| `src/store.ts` | Add 2 tables (`ith_model_profiles`, `ith_team_model_assignments`), add `IthStore` methods (`createProfile`, `listProfiles`, `getProfile`, `deleteProfile`, `upsertAssignment`, `assignmentsForRun`) | Schema + CRUD |
| `src/types.ts` | Add `ModelProfile`, `TeamModelAssignment` interfaces | Types only |
| `src/team.ts` | Modify `resolveAgentModel`, `buildModelChain`, `planRun` to accept optional profile model/fallbacks | Signature change (backward-compatible — new params are optional) |
| `extensions/ithacus-team.ts` | Pass `profileAssignments` to `createTeam`; persist assignments | Adapter |
| `extensions/ithacus-commands.ts` | Add `promptProfileSelection()` interactive flow; add `/ithacus-profiles` CRUD command | User-facing |
| `extensions/ithacus.ts` | Wire profile seeding into startup | 2 lines |

### 6.3 No changes needed

| File | Why |
|---|---|
| `src/config.ts` | Profiles are data, not config. `fallbackModels` in config remains the default when no profile is active. |
| `src/trim.ts` | Trim operates on messages, not models. Profile selection doesn't affect trim behavior. |
| `src/parallel.ts` | Batch execution is model-agnostic. |
| `extensions/ithacus-runtime.ts` | No new mutable state needed — profiles are in the store. |
| `extensions/ithacus-events/` | Event handlers don't need profile awareness. |

---

## 7. Dashboard Integration

The localhost dashboard (`extensions/ithacus-dashboard.ts`) gets three new sections:

### 7.1 Model Profiles

```json
{
  "modelProfiles": {
    "profiles": [
      { "id": "speed", "name": "Speed", "model": "claude-haiku-4-5-20251001", "isDefault": false },
      { "id": "quality", "name": "Quality", "model": "claude-sonnet-4-20250514", "isDefault": true }
    ],
    "total": 5
  }
}
```

### 7.2 Team Assignments

```json
{
  "teamAssignments": {
    "runId": "run-abc123",
    "assignments": [
      { "role": "Explore", "profile": "Speed", "model": "claude-haiku-4-5-20251001" },
      { "role": "Plan", "profile": "Reasoning", "model": "claude-opus-4-20250514" },
      { "role": "Verification", "profile": "Quality", "model": "claude-sonnet-4-20250514" }
    ]
  }
}
```

### 7.3 Cost Estimation

```json
{
  "costEstimate": {
    "runId": "run-abc123",
    "estimatedCost": "$0.45",
    "breakdown": [
      { "role": "Explore", "profile": "Speed", "est": "$0.02" },
      { "role": "Plan", "profile": "Reasoning", "est": "$0.30" },
      { "role": "Verification", "profile": "Quality", "est": "$0.13" }
    ]
  }
}
```

---

## 8. Cost Estimation

Each profile shows estimated cost per task. Cost data is **static pricing** (no
network calls — PREVENT-ITH-004), stored as a lookup table in `src/model-profiles.ts`.

### 8.1 Pricing table

```typescript
// src/model-profiles.ts
const MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'claude-haiku-4-5-20251001': { inputPer1M: 0.80, outputPer1M: 4.00 },
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-20250514':  { inputPer1M: 15.00, outputPer1M: 75.00 },
  'kimi':                     { inputPer1M: 0.60, outputPer1M: 2.40 },
  'qwen':                     { inputPer1M: 0.50, outputPer1M: 2.00 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;  // unknown model — no estimate
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

export function formatCostEstimate(model: string, typicalInput = 2000, typicalOutput = 4000): string {
  const cost = estimateCost(model, typicalInput, typicalOutput);
  if (cost === 0) return 'unknown';
  return `$${cost.toFixed(3)}`;
}
```

### 8.2 Estimation strategy

- **Per-task estimate**: Use typical token counts (2K input, 4K output) as baseline
- **Per-team estimate**: Multiply per-task by agent count
- **Display in prompt**: Show alongside profile name: `[2] Quality  claude-sonnet-4-20250514  ~$0.105/task`
- **No network**: Pricing is hardcoded, updated manually in source when providers change

### 8.3 Trade-off: static pricing vs. dynamic

| Approach | Pros | Cons |
|---|---|---|
| **Static (chosen)** | No fetch (extension source makes no network calls - PREVENT-ITH-004), deterministic, testable | Stale if pricing changes |
| Dynamic (API fetch) | Always current | Violates PREVENT-ITH-004, requires auth, fragile |

**Decision**: Static pricing. Update `MODEL_PRICING` manually when providers change
pricing. This is a rare event (quarterly at most) and the code change is trivial.

---

## 9. `/ithacus-profiles` Command

New slash command for profile CRUD:

```
/ithacus-profiles                    → List all profiles
/ithacus-profiles add <name> <model> [--provider <p>] [--fallbacks a,b,c]
/ithacus-profiles remove <name>
/ithacus-profiles set-default <name>
/ithacus-profiles show <name>        → Full details including params, cost estimate
```

### Implementation sketch

```typescript
// In extensions/ithacus-commands.ts
pi.registerCommand('ithacus-profiles', async (args, ctx) => {
  runtime.bindRepo(ctx.cwd);
  const sub = (args as string)?.trim() ?? '';

  if (!sub) {
    const profiles = runtime.store.listProfiles();
    return profiles.map(p =>
      `${p.isDefault ? '*' : ' '} ${p.name.padEnd(12)} ${p.model.padEnd(30)} ${p.description}`
    ).join('\n');
  }

  const [cmd, ...rest] = sub.split(/\s+/);
  switch (cmd) {
    case 'add': return addProfile(runtime.store, rest);
    case 'remove': return removeProfile(runtime.store, rest[0]);
    case 'set-default': return setDefaultProfile(runtime.store, rest[0]);
    case 'show': return showProfile(runtime.store, rest[0]);
    default: return `Unknown subcommand: ${cmd}. Use: add, remove, set-default, show`;
  }
});
```

---

## 10. Implementation Plan

### Phase 1: Data layer (src/) — P0

| Task | File | Description |
|---|---|---|
| 1.1 | `src/types.ts` | Add `ModelProfile`, `TeamModelAssignment` interfaces |
| 1.2 | `src/store.ts` | Add schema (2 tables), add CRUD methods |
| 1.3 | `src/model-profiles.ts` | Profile helpers, seeding, cost estimation, pricing table |
| 1.4 | `src/team.ts` | Extend `resolveAgentModel`, `buildModelChain`, `planRun` with optional profile params |
| 1.5 | `scripts/smoke-src.mjs` | Add profile resolution tests |

### Phase 2: Extension layer (extensions/) — P1

| Task | File | Description |
|---|---|---|
| 2.1 | `extensions/ithacus-commands.ts` | `promptProfileSelection()` + `/ithacus-profiles` command |
| 2.2 | `extensions/ithacus-team.ts` | Pass `profileAssignments` through `createTeam` |
| 2.3 | `extensions/ithacus.ts` | Wire `seedDefaultProfiles` into startup |

### Phase 3: Dashboard + polish — P2

| Task | File | Description |
|---|---|---|
| 3.1 | `extensions/ithacus-dashboard.ts` | Model Profiles, Team Assignments, Cost Estimate sections |
| 3.2 | `docs/DESIGN_MODEL_PROFILES.md` | Update with implementation notes |

---

## 11. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `pi.ask` not available in `ExtensionAPI` | Medium | Fall back to `--profile` flag parsing. Interactive prompt is ideal, not required. |
| Profile count explosion | Low | Cap at 20 profiles per scope. Seed only 5 defaults. |
| Stale pricing data | Low | `MODEL_PRICING` is a simple lookup table. Update quarterly. Clearly label as estimates. |
| Profile scope confusion (global vs repo) | Medium | Show scope in profile list. Repo profiles always override global with same name. |
| Backward compatibility of `planRun` signature | None | New params are optional (`profileModels?: Map<AgentRole, string>`). Existing callers pass nothing and get current behavior. |
| Race condition: profile deleted while team active | Low | `ith_team_model_assignments` has FK to `ith_model_profiles`. SQLite FK enforcement prevents deletion of in-use profiles. |

---

## 12. Trade-offs

### 12.1 Interactive prompt vs. config-only

| Aspect | Interactive (chosen) | Config-only (competitors) |
|---|---|---|
| **User control** | Per-task decision | Set once, forget |
| **Friction** | One extra prompt per team creation | Zero friction |
| **Flexibility** | Match model to task complexity | Same model for all tasks |
| **CI/scripting** | Needs `--profile` flag fallback | Works naturally |

**Decision**: Interactive with non-interactive fallback. The prompt is ~2 seconds of
time that saves significant cost and improves output quality.

### 12.2 Per-role vs. per-team

| Aspect | Per-role (default) | Per-team only |
|---|---|---|
| **Granularity** | Explorer=fast, Reviewer=thorough | All agents same model |
| **Complexity** | 4 selections per team | 1 selection per team |
| **Cost optimization** | High (cheap model for cheap work) | Medium |

**Decision**: Default to single profile for all agents. Offer per-role as opt-in `[P]`.
Most users want simplicity; power users want control.

### 12.3 Profile storage location

| Aspect | SQLite (chosen) | YAML/JSON file |
|---|---|---|
| **Consistency** | Single source of truth with runs/agents | Separate file to manage |
| **Query** | SQL joins for "which profiles are in use?" | Parse + filter |
| **Migration** | Schema migration handles it | File format versioning |

**Decision**: SQLite, per design principle P2. One store, one source of truth.

---

## 13. Breaking Changes Checklist

| Change | Breaking? | Migration |
|---|---|---|
| `resolveAgentModel` signature | ❌ New param optional | None needed |
| `buildModelChain` signature | ❌ New params optional | None needed |
| `planRun` signature | ❌ New param optional | None needed |
| New tables in store | ❌ `CREATE TABLE IF NOT EXISTS` | Auto-migrated on first open |
| New `IthStore` methods | ❌ Additive | None needed |

**No breaking changes.** All modifications are additive with optional parameters.
Existing behavior is preserved when no profile is specified.

---

## 14. Test Strategy

### Unit tests (`node --test` via `scripts/smoke-src.mjs`)

1. **Profile CRUD**: create, list, get, delete, set-default
2. **Seeding**: first open seeds 5 defaults; second open does not re-seed
3. **Resolution chain**: `resolveAgentModel('explicit', resolved, 'profile-model')` returns `'profile-model'`
4. **Resolution chain fallback**: `resolveAgentModel('explicit', resolved, null)` returns `'explicit'` (backward compat)
5. **buildModelChain with profile**: profile model first, profile fallbacks used
6. **buildModelChain without profile**: current behavior preserved
7. **planRun with profileModels**: agents get per-role models
8. **planRun without profileModels**: all agents get same model (current behavior)
9. **Cost estimation**: known models return correct estimates, unknown returns 0
10. **FK enforcement**: cannot delete profile referenced by active assignment

### Integration tests (extension layer)

1. **Interactive prompt**: `/ithacus-team medium test` shows profile list
2. **Per-role assignment**: `[P]` flow creates 4 assignment rows
3. **`/ithacus-profiles`**: CRUD operations work end-to-end
4. **Non-interactive**: `--profile speed` bypasses prompt
5. **Dashboard**: profile data appears in `dashboard.json`

---

## 15. Architecture Soundness Verdict

**Verdict: SOUND** ✅

The design integrates cleanly because:

1. **Layer separation preserved**: Profiles are data (src/), interactive prompt is adapter (extensions/)
2. **Backward compatible**: All new parameters are optional; existing behavior unchanged
3. **Schema idempotent**: `CREATE TABLE IF NOT EXISTS` — safe for existing stores
4. **No network**: Static pricing, local SQLite, `pi.ask` is local UI
5. **FK integrity**: Assignments reference profiles; SQLite enforces referential integrity
6. **P2 compliance**: Seeding + CRUD are local operations; no network calls in this code path (PREVENT-ITH-004)

The only risk is `pi.ask` availability in `ExtensionAPI`, mitigated by the `--profile` flag fallback.

---

## 16. Structured Output

```json
{
  "version": "1.0",
  "status": "design-complete",
  "summary": "Design for interactive model profile system — a unique ithacus differentiator. Users select model profiles at task time (interactive prompt or --profile flag). Profiles can be assigned per-role (Explorer=fast, Reviewer=thorough) or per-team. 5 pre-seeded defaults. Resolution chain extended: profile model takes highest precedence. Cost estimation via static pricing table. All changes backward-compatible, no breaking changes.",
  "files": [
    "docs/DESIGN_MODEL_PROFILES.md",
    "src/model-profiles.ts",
    "src/store.ts",
    "src/types.ts",
    "src/team.ts",
    "extensions/ithacus-commands.ts",
    "extensions/ithacus-team.ts",
    "extensions/ithacus.ts"
  ],
  "actions": [
    "Add ModelProfile and TeamModelAssignment types to src/types.ts",
    "Add ith_model_profiles and ith_team_model_assignments tables to src/store.ts",
    "Create src/model-profiles.ts with CRUD, seeding, cost estimation",
    "Extend resolveAgentModel/buildModelChain/planRun with optional profile params",
    "Add promptProfileSelection() interactive flow to extensions/ithacus-commands.ts",
    "Add /ithacus-profiles CRUD command",
    "Pass profileAssignments through createTeam in extensions/ithacus-team.ts",
    "Wire seedDefaultProfiles into startup in extensions/ithacus.ts",
    "Add profile/assignment/cost sections to dashboard",
    "Add profile resolution tests to scripts/smoke-src.mjs"
  ],
  "notDone": [
    "Verify pi.ask availability in ExtensionAPI (blocked: need to check pi SDK)"
  ],
  "nextSteps": [
    "Implement Phase 1 (data layer): types, store, model-profiles, team.ts changes",
    "Implement Phase 2 (extension layer): commands, team dispatch, wiring",
    "Implement Phase 3 (dashboard): profile/assignment/cost sections",
    "Run guardrails scan: node scripts/guardrails-scan.mjs",
    "Run regression check: python3 scripts/regression_check.py --all"
  ],
  "reasoning": [
    "Profile model takes highest precedence because user explicitly chose it at task time — more deliberate than session config",
    "Per-role is opt-in (default single profile) to minimize friction for casual users",
    "Static pricing table chosen over dynamic API to maintain PREVENT-ITH-004 (no fetch - extension source makes no network calls)",
    "All changes backward-compatible via optional parameters — no migration needed",
    "SQLite storage per design principle P2: one store, one source of truth",
    "FK enforcement prevents deletion of in-use profiles — data integrity guaranteed"
  ],
  "notes": [
    "No competitor (pi-crew, pi-messenger, oh-my-pi) does interactive model selection — this is a genuine differentiator",
    "The interactive prompt adds ~2 seconds per team creation but saves significant cost and improves quality",
    "Cost estimates are approximate — static pricing updated quarterly, clearly labeled as estimates",
    "Consider adding model aliases (e.g., 'fast' = 'claude-haiku-4-5-20251001') in a future iteration"
  ]
}
```