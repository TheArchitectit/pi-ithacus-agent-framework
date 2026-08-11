# ithacus — Opt-In Enterprise Features (Tier R)

**Design spec · Sprints 5.9 (A2A remote), 5.25 (external memory), 5.26 (fleet mesh)**

All features here are **Tier R** per DESIGN_TWO_TIER_POLICY.md: modules live
in `extensions/opt-in/`, carry scanner annotations, sit behind the capability
gate, default OFF, and are toggled from the web setup panel (Sprint 5.23).
When disabled they are inert — zero cost, zero attack surface.

---

## A. Sprint 5.9 — A2A Remote Adapter

### A.1 Goal

Let ithacus fleets talk to **other agent systems and remote ithacus nodes**
over the industry-standard **A2A protocol** (a2a.dev, Linux Foundation
project, v0.3.0), without touching the local-only core.

### A.2 Protocol shape (from landscape research)

Implement/accept the A2A v0.3.0 wire surface:

| Construct | What ithacus does |
|---|---|
| `AgentCard` (`/.well-known/agent-card.json`) | Publish card describing this node's ithacus agents, capabilities, auth schemes; fetch remote cards to discover peers |
| `message/send` | Send an ithacus mailbox message to a remote agent as an A2A message |
| `message/stream` | SSE streaming of remote agent replies (maps onto our eventBus) |
| `tasks/get`, `tasks/cancel` | Poll/cancel remote tasks (maps onto worker-status) |
| Auth | Bearer / OAuth2 client-credentials (memory-mcp pattern), API-key fallback; secrets via env only |

Transport: JSON-RPC 2.0 over HTTP(S); SSE for streams; WebSockets NOT
required. This is the proven memory-mcp `a2a/` pattern (tasks/streaming/
router/push/auth — all tested there) ported to TypeScript under the gate.

### A.3 Integration points

- `extensions/opt-in/a2a-server.ts` — expose local ithacus agents as A2A
  endpoints (loopback or LAN bind only; mesh exposure is 5.26's job).
- `extensions/opt-in/a2a-client.ts` — discover peers via AgentCard,
  send/stream/cancel.
- Bridge: A2A messages ↔ local `ith_inbox` mailbox (same message model, so
  local and remote peers look identical to agents).
- Worker-status events map to A2A task states for remote tasks.
- Guard: `requireCapability("a2a")` at every entry point.

### A.4 Tests

- Loopback round-trip: server + client on 127.0.0.1 (test-only, no real
  network): card discovery, message send, SSE stream receipt, task cancel.
- Gate tests: capability off → all entry points inert.
- Anti-pattern guard (memory-mcp lesson): `dispatch` must actually dispatch —
  regression fixture asserts no no-op COMPLETED shortcuts.

---

## B. Sprint 5.25 — External Memory Tier (opt-in)

### B.1 Goal

Optional **semantic memory backend** (pgvector class) for teams that want
shared fleet memory beyond the local sqlite hindsight store. Default stays
sqlite — this never replaces Tier L memory.

### B.2 Design

- `extensions/opt-in/memory-external.ts` — adapter implementing a narrow
  `MemoryBackend` interface: `store(entry)`, `recall(query, k)`,
  `consolidate(runId)`.
- Reference backend: Postgres + pgvector (memory-mcp pattern), connection
  string from env (`ITHACUS_MEMORY_DSN`) — never from config files
  (secrets rule).
- Embedding: local-only embedding provider first (Ollama HTTP on localhost —
  still "external" per policy, hence opt-in); no hosted embedding APIs in v1.
- Consolidation hooks into Sprint 5.18's memory consolidation pipeline:
  sqlite stays primary store; external tier is a recall-augmenting index.
- Capability: `external_memory`. Gate at every adapter call.

### B.3 Anti-patterns to avoid (memory-mcp lessons)

- Never embed the *compacted* text instead of originals.
- Score semantics must match the distance metric (pgvector cosine: higher =
  closer; do not invert).
- Session IDs: no prefix truncation.

---

## C. Sprint 5.26 — Fleet Mesh (opt-in)

### C.1 Goal

Secure multi-machine agent fleets: ithacus nodes discover and message each
other over a **Tailscale-class mesh**, governed like Aperture governs AI
agent traffic.

### C.2 Design

- Transport is BYO-mesh: ithacus does NOT ship a mesh — it rides Tailscale
  (or equivalent WireGuard mesh). Node identity = Tailscale identity;
  ithacus adds nothing cryptographic of its own.
- `extensions/opt-in/mesh.ts` — peer registry (AgentCards advertised over
  mesh DNS), presence heartbeats (extends `src/presence.ts`), message
  routing via the 5.9 A2A client.
- Capability: `mesh`. Requires `a2a` capability too (gate enforces the
  dependency).
- Security posture: loopback A2A server binds to the mesh interface only
  when mesh is enabled; peer allowlist in project config.

### C.3 Explicit non-goals

- No libp2p, no custom NAT traversal, no own PKI. (Landscape verdict:
  Tailscale/NetBird class solves this better than any framework-local
  attempt.)

---

## D. Cross-cutting rules (all Tier R)

1. Every module: annotation header + `requireCapability()` at entry +
   audit events on enable/disable/block.
2. Secrets only via env; scanner's secret patterns apply to opt-in too.
3. Each capability ships with loopback-only tests (no real external calls
   in CI/local gates).
4. Docs: README + web-panel risk notes per capability.
5. Version bumps remain deploy.sh-owned; each capability is its own sprint
   and its own patch release.

## E. Sequencing & dependencies

```
5.24 two-tier policy (gate, scanner, config)
 ├─ 5.23 web interface + setup panel (toggle surface)
 ├─ 5.9  A2A remote adapter
 │    └─ 5.26 fleet mesh (requires 5.9 + Tailscale)
 └─ 5.25 external memory (requires 5.18 consolidation)
```

## F. Provenance

- A2A protocol: a2a.dev v0.3.0 (Google ADK / MAF reference implementations).
- A2A module layout: memory-mcp `src/memory_mcp/a2a/` (tested patterns).
- Mesh governance: Aperture Secure AI / Tailscale for agents
  (GAP_ANALYSIS_2026_LANDSCAPE.md §5b, §5c).
- Anti-patterns: RESEARCH_EXTERNAL_SOURCES.md (memory-mcp audit).
