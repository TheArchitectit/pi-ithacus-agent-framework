# ithacus — Two-Tier Trust & Connectivity Policy

**Sprint 5.24 · Design spec (foundation for all opt-in remote features)**

## 1. Goal

Evolve PREVENT-ITH-004 from a blanket "zero network in extension source" rule
into an explicit **two-tier model**:

- **Tier L (Local, default, always on):** everything ithacus ships and runs
  out of the box — sqlite store, in-process mailbox/dispatch, live overlay,
  web UI (loopback), permission modes. Zero external services, zero
  subscriptions, zero runtime network. This tier is non-negotiable and
  scan-enforced exactly as today.
- **Tier R (Remote, opt-in, default OFF):** capabilities that require network
  — A2A federation (Sprint 5.9), external memory backends (5.25), fleet mesh
  over Tailscale-class transports (5.26). Each is a separate module in
  `extensions/opt-in/`, gated by an explicit toggle that the setup panel
  (Sprint 5.23) manages, annotated for the scanner, and inert when disabled.

This is the policy prerequisite for every remote feature. Nothing in Tier R
ships until this spec lands.

## 2. Why now

- The 2026 landscape (`GAP_ANALYSIS_2026_LANDSCAPE.md`) shows the winning
  shape for ithacus v1.0 is *local-first enterprise harness + opt-in fleet*:
  ADK/MAF ship A2A servers; Aperture/Tailscale govern mesh access; Claude
  Code keeps everything local + hook-gated. ithacus matches by keeping Tier L
  pristine and making Tier R a clean, audited exception.
- The user requirement is explicit: "external or tailscale network is
  acceptable **as long as it defaults off and there's a toggle in the setup
  panel** in the web interface."

## 3. Policy mechanics

### 3.1 Module placement

| Tier | Location | Scanner treatment |
|---|---|---|
| L | `src/`, `extensions/*.ts`, `extensions/ithacus-events/` | Current PREVENT-ITH-004 rules, zero exceptions |
| R | `extensions/opt-in/*.ts` (new dir) | Network strings permitted **only** with a file-level `// guardrails-allow PREVENT-ITH-004: <capability>` header annotation; each opt-in module also carries a runtime capability gate (§3.3) |

The scanner (`scripts/guardrails-scan.mjs`) gains:
1. `extensions/opt-in/` is the ONLY path where `guardrails-allow PREVENT-ITH-004`
   annotations are honored for network-capable constructs (fetch/http/net/
   ws/grpc/libp2p string patterns). Annotations anywhere else remain errors.
2. Every `extensions/opt-in/*.ts` MUST have a valid annotation header or the
   scan fails (opt-in code must self-declare its capability).
3. Regression check: no file outside `extensions/opt-in/` may reference an
   opt-in module without going through the capability gate (§3.3) — enforced
   by a new pattern rule (PREVENT-ITH-005, error severity).

### 3.2 Configuration

`src/config.ts` gains (pi-agnostic, pure):

```ts
export interface RemoteCapabilities {
  /** Master switch. False → every Tier-R module is inert regardless of
   *  individual toggles. Default false. */
  remoteEnabled: boolean;
  /** Per-capability toggles. Only meaningful when remoteEnabled. */
  capabilities: Record<string, boolean>;  // keys: "a2a" | "external_memory" | "mesh"
}
```

- Sources, in precedence order: env (`ITHACUS_REMOTE`,
  `ITHACUS_REMOTE_CAPS=a2a,mesh`), project config (`.ithacus/config.json` →
  `remote` key), then defaults (all off).
- Toggles set via the setup panel write the project config file and
  `ith_kv` (existing store seam), and require a re-activation notice.

### 3.3 Runtime capability gate

`extensions/opt-in/gate.ts` (Tier R, annotated):

```ts
export function capabilityEnabled(cap: string, cfg: IthacusConfig): boolean;
export function requireCapability(cap: string, cfg: IthacusConfig): void; // throws CapabilityDisabledError
```

Every opt-in module's public entry point calls `requireCapability()` first.
The gate reads config fresh (no cached env) so a toggle flip is respected on
the next call. Failure mode: module degrades to its Tier-L fallback or no-ops
with an audit event (`appendEvent("remote_capability_blocked")`) — never
crashes the local tier.

### 3.4 Audit & transparency

- Every Tier-R activation (first enable per session) emits a `remote_enabled`
  audit event with capability list.
- The setup panel and `/ithacus-remote status` show exactly which
  capabilities are on, which modules loaded, and which annotation covers
  which module.
- Docs: CLAUDE.md gains the two-tier section; AGENT_GUARDRAILS.md FORBIDDEN
  ACTIONS unchanged for Tier L.

## 4. Scanner + regression deliverables

1. `scripts/guardrails-scan.mjs`: opt-in dir handling + annotation validation.
2. `.guardrails/prevention-rules/pattern-rules.json`: PREVENT-ITH-005
   (error): "non-opt-in code must not import extensions/opt-in/* without the
   capability gate".
3. `scripts/regression_check.py --all`: verify opt-in annotation discipline
   (each opt-in file annotated; no stray network strings in Tier L — existing
   rules still apply).
4. smoke-src section: capability resolution (env > project config > defaults;
   master switch dominates; unknown caps rejected).

## 5. What this does NOT do

- No network code ships with this sprint. `extensions/opt-in/gate.ts` is the
  only new Tier-R file, and it makes zero network calls.
- No UI (that's 5.23). This sprint is policy + scanner + config + gate only.

## 6. Test plan

- Unit: capability resolution matrix (master off × cap on → disabled; master
  on × cap off → disabled; both on → enabled; env override; malformed caps).
- Scanner: fixture opt-in file without annotation → scan fails; annotated →
  passes; annotation in Tier-L file → scan fails.
- Regression: PREVENT-ITH-005 fixture.

## 7. Guardrails

- PREVENT-ITH-004 remains absolute for Tier L; this spec only formalizes the
  already-documented annotation escape for a dedicated subtree.
- PREVENT-ITH-005 added to keep the boundary honest.
- PREVENT-ITH-001/002/003 untouched.

## 8. Provenance

- Claude Code: local default + hook-gated escalation.
- Aperture Secure AI / Tailscale: governed mesh access patterns
  (GAP_ANALYSIS_2026_LANDSCAPE.md §5b).
- User directive: default-off toggles in the web setup panel.
