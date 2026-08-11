# ithacus — Web Interface & Setup Panel

**Sprint 5.23 · Design spec**

## 1. Goal

Give ithacus a **local-first web UI** — the dashboard/setup surface the
project has never had (the 2026 landscape matrix scores ithacus "no web
dashboard" vs best-in-class OpenClaw Control UI / Codex Cloud / Aperture).
It is also the **toggle surface** for the two-tier policy (Sprint 5.24):
every opt-in remote capability gets a default-OFF switch here.

Design model: **pi-mega-compact's dashboard pattern** — lightweight local
server, loopback-only, bundled static assets, zero external services.

## 2. Scope

### 2.1 Architecture

- `extensions/ithacus-web.ts` — registers `/ithacus-web` command group +
  serves the UI when active.
- Server: Node built-in `node:http` (PREVENT-ITH-004: no deps, no external
  fetch — serving loopback is Tier L). Binds **127.0.0.1 only**, ephemeral
  or fixed port (`ITHACUS_WEB_PORT`, default 7447), refuses non-loopback
  binds outright.
- Transport to browser: **SSE** (`text/event-stream`) fed directly from
  `runtime.eventBus` — same typed event stream that drives the terminal
  overlay. One stream, many views, now including the web view.
- Static assets: bundled in `extensions/web/` (plain HTML/CSS/vanilla JS,
  no build step, no CDN — PREVENT-ITH-004 + offline-capable).

### 2.2 Views

1. **Dashboard** — fleet overview: live dispatches (workflow chain),
   worker-status distribution, team/agent roster with models, cost so far,
   store stats. Mirrors `listLive()` + presence + cost tracker data.
2. **Live** — per-dispatch detail: status timeline, tokens/tps, tool
   activity log, failure classification. Same data as the terminal card.
3. **Inbox** — mailbox view: threads per agent, unread counts
   (read-only in v1; send comes with a later sprint if needed).
4. **Setup panel** — THE key view (§2.3).
5. **Guardrails** — failure registry + prevention rule status, recent
   gate results (read-only).

### 2.3 Setup panel (the toggle surface)

Sections, persisted to project config + `ith_kv`:

- **Agent models** — dynamic roster from `discoverIthacusAgents()` (same
  source as `/ithacus-setup`): per-agent model/provider binding, add/remove
  project-local agents, `.local.md` overrides visible.
- **Teams** — preview section; binds to team presets when Sprint 5.21 lands
  (read-only until then).
- **Remote capabilities (Tier R)** — master switch + per-capability toggles
  (`a2a`, `external_memory`, `mesh`), each default OFF, each showing its
  annotation/module path and a plain-language risk note. Flipping requires
  confirming a warning. Status readout per §3.4 of DESIGN_TWO_TIER_POLICY.
- **Limits** — max concurrency, dispatch timeout, compact policy.
- **About** — version, gate status, docs links (local only).

### 2.4 API surface (loopback JSON + SSE)

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | static UI |
| `/api/events` | GET (SSE) | eventBus stream (capability-filtered) |
| `/api/state` | GET | snapshot: fleet, live, roster, config |
| `/api/config` | GET/POST | read/update project config (setup panel writes) |
| `/api/agents` | GET | discovered agent roster |
| `/api/inbox` | GET | mailbox threads |

Auth: loopback bind is the security boundary; a random per-session token in
the served page guards the POST endpoint against local CSRF-style misuse.
No credentials, no cloud, no analytics (PREVENT-ITH-004).

## 3. Non-goals (v1)

- No remote/multi-user access (that's Tier R mesh, Sprint 5.26).
- No agent *control* from the web (no kill/dispatch buttons — v1 is
  observe + configure only; control arrives after the permission story
  matures).
- No bundlers/frameworks; vanilla JS + SSE.

## 4. Test plan

- smoke-ext: server binds loopback only; refuses `0.0.0.0`; state endpoint
  shape; SSE content-type; POST guarded by token; config round-trip.
- Unit: config write paths (`remote` key validation — unknown capabilities
  rejected; master switch dominates).
- Manual: open `http://127.0.0.1:7447` in a browser while a dispatch runs;
  verify live updates via SSE.

## 5. Guardrails

- PREVENT-ITH-004 honored: `node:http` loopback serving is local, no
  external calls; static assets bundled (no CDN).
- PREVENT-ITH-005 (two-tier): web UI is Tier L; Tier R toggles merely write
  config — they never import opt-in modules directly.

## 6. Ordering

Ships **after** Sprint 5.24 (two-tier policy) so the toggle panel has the
config schema + capability gate to write into. Both are small and can be
paired: 5.24 policy first, 5.23 UI second (this inversion from the
landscape doc is deliberate — schema before surface).

## 7. Provenance

- pi-mega-compact dashboard (local server + loopback + bundled assets).
- OpenClaw Control UI, Codex Cloud dashboards, Aperture console — as
  capability reference, not dependency (GAP_ANALYSIS_2026_LANDSCAPE.md §5a).
- Event-bus SSE pattern: our own Sprint 5.20 design, first non-terminal
  consumer.
