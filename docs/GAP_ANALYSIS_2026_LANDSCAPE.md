# Gap Analysis — ithacus vs the 2026 Multi-Agent Framework Landscape

> **Status**: Research + synthesis complete.
> **Date**: 2026 (post–ithacus v0.6.x; pre–v1.0).
> **Author**: ithacus research agent (plan agent, research+write task).
> **Scope**: Competitive landscape survey (2025–2026 releases only) + 20-row feature-gap
> matrix vs ithacus's shipped baseline, feature candidates for future sprints, and four
> focused evaluations (dashboard pattern, mesh networking, A2A for Sprint 5.9, permission
> models).
> **Constraint honored**: Markdown under `docs/` only. Per `CLAUDE.md` task #25, **no
> references to pi-mega-compact** appear anywhere — the "web dashboard pattern" evaluation
> (item 5a) therefore cites the *category* (localhost-first control planes) via radcode,
> OpenHands Agent Canvas, CrewAI AMP, and LangSmith, deliberately not the scrubbed project.

---

## 0. Sources & method

Web research was performed with live fetches (curl/python) against authoritative
primary sources: protocol specs, framework READMEs, and vendor docs. Internal ithacus
state is taken from the sprint plan and shipped designs. Every external claim carries a
URL in §8.

| Source file (research scratch) | What it backed |
|---|---|
| `a2a_spec.md`, `a2a.md` | A2A protocol shape (AgentCard, JSON-RPC, SSE, push, auth) |
| `adk.md` | Google ADK 2.0 (Workflow Runtime, Task API) |
| `openai_agents.md`, `openai_agents_doc.md` | OpenAI Agents SDK (handoffs, sandbox, guardrails, tracing) |
| `claude_subagents.md`, `claude_teams2.md` | Claude Code subagents + agent teams |
| `langgraph.md`, `crewai.md`, `autogen.md`, `maf.md`, `smolagents.md`, `metagpt.md`, `camel2.md` | Orchestration frameworks |
| `mcp.md`, `mcp_auth.md`, `mcp_auth2.md` | MCP 2025-06-18 + OAuth 2.1 authorization |
| `bedrock.md`, `vertex.md`, `openhands.md`, `goose.md` | Enterprise / self-hosted platforms |
| `tailscale_kb.md`, `aperture.md` | Mesh networking + Aperture: Secure AI |

Internal cross-references: `docs/GAP_ANALYSIS_RADCODE_WORKFLOW.md`,
`docs/RESEARCH_EXTERNAL_SOURCES.md`, `docs/DESIGN_TEAMS_AND_SIZES.md`,
`docs/SPRINT_PLAN.md`, plus the `DESIGN_*.md` set for shipped sprints 5.13/5.14/5.15/5.20.

---

## 1. Landscape table

Columns: **Teams** | **Memory** | **A2A protocol** | **Permissions** | **Observability/UI** |
**Packaging** | **License** | **Local-only capable**.

| Framework | Teams | Memory | A2A protocol | Permissions | Observability/UI | Packaging | License | Local-only |
|---|---|---|---|---|---|---|---|---|
| **ithacus** (pi extension) | Named teams + DAG + swarm + dynamic sizing (5.21 spec) | node:sqlite (hindsight retain/recall/reflect + consolidation spec) | Planned (5.9) | PermissionMode + spawn-boundary + trust ceilings + secret redaction (5.15) | Live overlay + typed event bus + menu + dashboard spec (5.12) + Prometheus/OTLP | npm (`pi install npm:ithacus`) + agent bundles | MIT-ish (ithacus) | **YES** (PREVENT-ITH-004) |
| **pi.dev** (runtime host) | Extension-spawned agents | Extension state | — | Extension capability model | overlay/components UI | npm extension | — | YES (harness) |
| **claw-code / OpenClaw** (surveyed) | `TeamRegistry` + `CronRegistry` + workers | context window only | No | PermissionArg presets (ReadOnly/WorkspaceWrite/…) | TUI/worker status | binary | MIT | YES |
| **Claude Code** (Anthropic) | Subagents + **Agent Teams** (shared task list, claim, direct messaging) | subagent context windows + CLAUDE.md (no shared store) | No | PermissionMode + subagent allowlists + **untrusted agent-relay** | TUI agent panel + dashboards | CLI binary | Proprietary | Partial (harness local; models API) |
| **OpenAI Agents SDK** | Handoffs + agents-as-tools + groups | Sessions (Redis opt) + agent memory | No | Guardrails (in/out validation) | Built-in Tracing | pip / npm | Apache-2.0 | YES (provider-agnostic) |
| **Google ADK 2.0** | Workflow Runtime (graph) + Task API (A2A delegation) + multi-agent | session/memory state | **YES** (expose ADK agents as A2A servers) | tool auth / IAM | ADK Web UI + Agent Platform | pip | Apache-2.0 | Partial (local SDK; models remote) |
| **Microsoft Agent Framework** (AutoGen successor) | sequential/concurrent/handoff/group + Foundry hosted | state + declarative agents | **YES** (cross-runtime via A2A+MCP) | governance + middleware | OpenTelemetry + DevUI | pip / NuGet | MIT | YES (cloud opt) |
| **LangGraph** | graph orchestration + Deep Agents (subagents) | short + long-term memory | via samples | HITL interrupts | LangSmith | pip / npm | MIT | YES |
| **CrewAI** | Crews (role-based) + Flows (event-driven) | per-agent memory | via samples | security in AMP Suite | AMP control plane (tracing) | pip | MIT | YES |
| **AutoGen-AG2** (community fork) | AgentChat multi-agent | conversation memory | No | — | — | pip | MIT | YES |
| **smolagents** (HF) | CodeAgent + managed agents | model memory | No | sandbox exec (Blaxel/E2B/Docker) | Hub | pip | Apache-2.0 | YES |
| **MetaGPT** | SOP roles (PM/architect/engineers) | role memory | No | — | mgx.dev | pip | MIT | Partial (needs API) |
| **CAMEL** | multi-agent society + role play | memory modules | No | — | — | pip | Apache-2.0 | YES |
| **AWS Bedrock Agents / AgentCore** | action groups + knowledge bases + multi-agent collab | session memory + RAG KB | No | IAM + user permissions | managed dashboards/tracing | cloud service | Proprietary | **NO** (cloud) |
| **Vertex AI Agent Engine / Gemini Enterprise Agent Platform** | Agent Engine + Agent Platform + ADK | Agent Platform Memory Bank + Sessions + RAG | via ADK | agent identity / OAuth clients | tracing + eval service | cloud service | Proprietary | **NO** (cloud) |
| **OpenHands (Agent Canvas)** | multi-backend team + automations | per-agent + microagents | via ACP | backend permissions + sandbox | **self-hosted web control center** | Docker / self-host | MIT | **YES** (local-first) |
| **Goose** (AAIF/LF) | single agent + sessions | extension-based | via MCP/ACP | provider/tool scoping | desktop/CLI/API | desktop/CLI | Apache-2.0 | YES |
| **MCP** (protocol) | N/A (tools protocol) | N/A | complements A2A | OAuth 2.1 (2025-06-18) | N/A | npm/PyPI SDKs | MIT | YES |
| **A2A** (protocol) | N/A (agent-interop) | N/A (preserves opacity) | **Native** | OAuth2/OIDC/MutualTLS/APIKey | N/A | multi-lang SDKs | Apache-2.0 (LF) | YES |
| **Tailscale** (mesh) | N/A (networking) | N/A | transports A2A | ACLs + Aperture: Secure AI | flow logs / client metrics | binary + control plane | Proprietary (free + Enterprise) | Partial (peer mesh local; coord via Tailscale) |

**Key takeaways:**

- The 2026 field split into **cloud platforms** (Bedrock AgentCore, Vertex Agent
  Platform) vs **local-first frameworks** (ithacus, claw-code, OpenHands, Goose,
  MAF, LangGraph, CrewAI, smolagents). ithacus sits squarely in the local-first,
  enterprise-on-prem camp — its differentiation is *not* cloud scale but *local
  enforcement + zero external services* (PREVENT-ITH-004).
- **A2A is now the interop lingua franca**: ADK, MAF, LangGraph, and CrewAI all
  ship A2A server/client samples. Sprint 5.9 positions ithacus to join this mesh.
- **OpenTelemetry / tracing / control-plane UIs** are table-stakes for "enterprise"
  perception even when local (MAF DevUI, CrewAI AMP, OpenHands Canvas, LangSmith).
  ithacus's 5.12 dashboard + 5.20 event bus is the right answer.
- **Permission-as-relay-prevention** (Claude Code agent teams) is a 2026 best
  practice ithacus should adopt explicitly (§5d, §6).

---

## 2. Feature-gap matrix (20+ rows)

Legend: **OWNED** = shipped in `src/`/`extensions/`; **PARTIAL** = shipped-in-part
or spec-complete-not-yet-shipped or planned; **GAP** = not built (maybe planned);
**BY-DESIGN-OUT** = deliberately excluded per local-only ethos / pi-agnostic rule.

| # | Capability | ithacus today | Best-in-class reference | Verdict |
|---|---|---|---|---|
| 1 | Per-agent model/provider dispatch | `config.ts` `resolveProviderForModel`, model profiles, 5.10 dispatch, 5.12.5 bundles | OpenAI Agents SDK (100+ LLMs), ADK (Gemini/Claude/Ollama/vLLM/LiteLLM) | **OWNED** |
| 2 | Named team orchestration | `team.ts` + 5.19 named teams spec | Claude Code Agent Teams, MAF group collaboration | **OWNED** (5.19 spec) |
| 3 | DAG workflow engine | `workflow.ts` topsort/waves; 5.2 rich steps | ADK Workflow Runtime, LangGraph graphs | **OWNED** |
| 4 | Swarm dispatch + synthesis | 5.4 `swarm.ts`+`synthesis.ts` (real spawn) | memory-mcp SwarmOrchestrator (stubbed — anti-pattern §6) | **OWNED** |
| 5 | Dynamic team sizing / composition | 5.21 `DESIGN_TEAMS_AND_SIZES.md` (not shipped) | Claude Code adaptive team size (3–5 rec.) | **PARTIAL** |
| 6 | Inter-agent negotiation + handoff | 5.3 `negotiation.ts`+`handoff.ts` (in-process) | A2A Task delegation | **OWNED** (local); **GAP** (cross-machine) |
| 7 | Agent mailbox / blackboard (in-process) | `ith_inbox` sqlite mailbox + 5.6 bus spec | Claude Code team mailbox (`~/.claude/teams/.../inboxes/*.json`) | **OWNED** (mailbox); **PARTIAL** (pub/sub bus) |
| 8 | Shared task list + lease claiming | `queue.ts` priority state machine; 5.7 claiming spec | Claude Code shared task list (file-lock claim) | **PARTIAL** |
| 9 | Leader election + capability delegation | 5.5 `leader.ts` planned | radical leader_election/delegation | **GAP** |
| 10 | Keyword→role weighted router | 5.5 `router.ts` planned | memory-mcp operators | **GAP** |
| 11 | Live progress overlay + typed event bus | 5.13 `events.ts`+overlay; 5.20 one-stream-many-views | radcode stream-event TUI, OpenAI Tracing | **OWNED** |
| 12 | Rich worker-status state machine | 5.14 `worker-status.ts` (7 states + failure kind) | claw-code `WorkerStatus` | **OWNED** |
| 13 | Web dashboard (observability UI) | 5.12 spec (localhost loopback) | OpenHands Agent Canvas, CrewAI AMP, LangSmith | **PARTIAL** |
| 14 | Metrics export (Prometheus/OTLP) | 3.5 `metrics.ts` Prometheus + OTLP | MAF OpenTelemetry, LangSmith | **OWNED** |
| 15 | Spawn-boundary permission enforcement | 5.15 `permissions.ts`+`extension-trust.ts` (`--tools` allowlist, deny wins) | Claude Code subagent allowlists, OpenAI guardrails | **OWNED** |
| 16 | Trust ceilings / source-trust | 5.15 `extension-trust.ts` source-trust ceiling | Claude Code agent-teams (inherit lead perms) | **OWNED** |
| 17 | Secret redaction in audit logs | 5.15 `redact.ts` (`permission_resolved` redacted) | — | **OWNED** |
| 18 | Plan-approval / HITL quality gates | explorer/plan read-only agents; no team-task gate yet | Claude Code agent teams (hook exit 2 blocks completion) | **PARTIAL** |
| 19 | Auto-compact + retry on ctx-window error | 5.17 spec (fresh-child rebuild) | claw-code PRs #1–4 (had reuse bug → §6) | **PARTIAL** |
| 20 | Session checkpoint manager | 5.16 spec (list/delete/archive/compare) | memory-mcp session_context | **PARTIAL** |
| 21 | Memory consolidation (Trident-style) | 5.18 spec (token-overlap, no embeddings) | memory-mcp Trident (Postgres — out of scope) | **PARTIAL** |
| 22 | Reverse prompt validation | 1.4 `validator.ts` RPV | — | **OWNED** |
| 23 | Cost budget governor (USD cap) | `cost.ts` tracks; `budget.ts` USD cap planned (5.5) | memory-mcp swarm_v2 budget | **PARTIAL** (track OWNED; cap GAP) |
| 24 | Presence / file reservations | 1.3 `presence.ts`+`reservations.ts` | — | **OWNED** |
| 25 | npm-shipped upgrade-safe bundles + dynamic setup | 5.12.5 `DESIGN_AGENT_BUNDLES.md` spec | Goose custom distros, OpenHands backends | **PARTIAL** (spec) |
| 26 | Guardrails + regression + deploy pipeline | `scripts/` (scan + regression + deploy) | DevGate-adapted | **OWNED** |
| 27 | A2A adapter (AgentCard/JSON-RPC/SSE/push) | 5.9 spec (network-gated, opt-in) | ADK/MAF A2A servers | **GAP** (planned 5.9) |
| 28 | MCP server w/ OAuth 2.1 | MCP *client* via pi; no OAuth2.1 *server* | MCP 2025-06-18 authorization (RFC8414/7591/9728) | **PARTIAL** (client); **GAP** (server) |
| 29 | Agent fleet mesh networking (machine-to-machine) | local pi subprocesses only; no transport | Tailscale tailnet + Aperture: Secure AI | **GAP** (candidate §4-2) |
| 30 | Durable execution / time-travel | `checkpoint.ts` rewind (2.1); no distributed durability | LangGraph durable exec, MAF time-travel | **PARTIAL** |
| 31 | Vector/semantic memory tiers (embeddings) | BY-DESIGN on node:sqlite token-overlap (5.18) | pgvector/Redis/Ollama stacks | **BY-DESIGN-OUT** (PREVENT-ITH-004) |
| 32 | Hosted control plane / cloud RAG | none | Bedrock/Vertex managed | **BY-DESIGN-OUT** |
| 33 | Autonomous autoscaling fleets | bounded concurrency cap (24) by design | cloud auto-scale | **BY-DESIGN-OUT** (local ethos) |

**Scorecard:** OWNED ≈ 18, PARTIAL ≈ 13, GAP ≈ 7, BY-DESIGN-OUT ≈ 3. ithacus's
orchestration/permission/observability core is already at parity or ahead; the open
surface is **cross-machine interop (A2A #27, mesh #29), durable execution (#30), and
the unshipped specs (5.12/5.16/5.17/5.18/5.19/5.21)**.

---

## 3. 2026 trend synthesis — what matters for ithacus v1.0

ithacus's stated identity (per `CLAUDE.md`): *"an agent framework to run with pi.dev
so we can set different agents with different models to do task work"* — a **local
enterprise harness running on pi**, zero external services (PREVENT-ITH-004).

Trends that matter, ranked:

1. **Local-first is a winning moat, not a limitation.** Bedrock/Vertex went fully
   cloud; OpenHands, Goose, MAF, LangGraph, CrewAI, smolagents all re-emphasized
   *self-host / on-prem / bring-your-own-model*. ithacus's `node:sqlite` +
   Node-builtins + npm distribution is exactly the on-prem enterprise shape. **Lean
   into "runs air-gapped" as a selling point.**
2. **A2A is the interop standard; ADK + MAF already speak it.** Sprint 5.9 is not
   optional for credibility — it is the on-ramp to a fleet. But keep it *opt-in,
   default-OFF* (two-tier model) to honor PREVENT-ITH-004.
3. **Observability/UIs are perception-critical even when local.** MAF ships
   DevUI+OpenTelemetry; CrewAI ships AMP; OpenHands ships Agent Canvas; LangGraph
   ships LangSmith. ithacus's 5.12 dashboard + 5.20 single event stream is the
   correct, lightweight (loopback, Node-builtins) answer. Ship it before v1.0.
4. **Permission models are converging on allowlists + relay-prevention.** Claude
   Code's "messages between agents are untrusted input" is the 2026 pattern. ithacus
   already has allowlist enforcement (5.15); add the *relay-prevention* + *hook gate*
   concepts (§5d).
5. **Durable execution / time-travel is table-stakes for "production".** LangGraph
   and MAF both lead with it. ithacus has rewind (2.1) but not distributed durability
   — a v1.0 differentiator candidate (#30), implementable locally on sqlite.
6. **MCP + A2A are complementary, not competing.** MCP = tools/context; A2A =
   agent-to-agent. ithacus already consumes MCP via pi; 5.9 adds A2A; adding an
   *OAuth 2.1-secured MCP server* surface (§4-8) lets ithacus agents be consumed by
   other frameworks — a low-cost interoperability win.
7. **Anti-framework-risk:** AutoGen went to *maintenance mode* (superseded by MAF).
   Lesson: keep `src/` pi-agnostic and dependency-free so ithacus is never hostage to
   a single upstream. ithacus already does this (Node builtins only).
8. **Mesh networking for agent fleets** is an emerging enterprise ask (the user
   specifically raised it). Tailscale's tailnet + Aperture: Secure AI is the
   reference pattern — encrypt peer-to-peer, govern LLM-provider egress, cap spend
   (§5b).

---

## 4. Feature candidates for future sprints

Each tagged with **provenance** (source project), **effort** (S/M/L/XL), and
**PREVENT-ITH-004 tier** (default-local = no network; opt-in-remote = requires
annotated exception, default-OFF, like `search.ts`/5.9).

| ID | Candidate | Provenance | Effort | Tier | Notes / maps to |
|---|---|---|---|---|---|
| 4-1 | **A2A network adapter** (AgentCard discovery, JSON-RPC HTTP binding, SSE streaming, push notifications) | A2A (`a2aproject/A2A`, Apache-2.0, LF) | XL | opt-in-remote | Sprint 5.9. Wire `src/` negotiation/handoff/bus/task-lifecycle to remote agents. Default-OFF. |
| 4-2 | **Agent fleet mesh** (Tailscale-style encrypted peer mesh + Aperture-style provider egress control + spend cap) | Tailscale tailnet + Aperture: Secure AI | L | opt-in-remote | Underlay for 4-1 across machines; two-tier (single-machine default). |
| 4-3 | **Web dashboard (localhost)** | OpenHands Agent Canvas, radcode `web/`, CrewAI AMP | M | default-local (loopback exception) | Sprint 5.12. Reads same `dashboard.json`+`events.log` as overlay; Node-builtins only. |
| 4-4 | **Permission relay-prevention + hook quality gates** | Claude Code agent teams (untrusted relay; hook exit 2) | M | default-local | Extend 5.15: treat inter-agent messages as untrusted; `TaskCompleted`-style gate. |
| 4-5 | **HITL plan-approval gate for mutating agents** | Claude Code plan-approval flow | M | default-local | Gate `writer`/mutating slots behind lead approval (ties to 5.15/5.21). |
| 4-6 | **Durable execution / time-travel** | LangGraph durable exec, MAF checkpointing+time-travel | L | default-local | Extend `checkpoint.ts` + sqlite event log for replay (5.16). |
| 4-7 | **Memory consolidation w/ semantic tiers (sqlite-only)** | memory-mcp Trident (concept only; no embeddings) | M | default-local | Sprint 5.18. Token-overlap scoring; BY-DESIGN no vector DB. |
| 4-8 | **MCP server with OAuth 2.1** | MCP 2025-06-18 authorization (RFC8414/7591/9728) | M | opt-in-remote | Let external frameworks consume ithacus agents as OAuth2.1-secured MCP servers. |
| 4-9 | **Observability export polish (OTLP sink + dashboard widgets)** | MAF OpenTelemetry, LangSmith | M | default-local | Wire `metrics.ts` OTLP into 4-3 dashboard. |
| 4-10 | **Leader election + keyword router + budget governor** | radical/memory-mcp | M | default-local | Sprints 5.5/5.7. Close GAP rows #9/#10/#23. |
| 4-11 | **Sandbox execution isolation for mutating slots** | OpenAI SandboxAgent, Goose | M | default-local | Worktree + container option for `writer`; complements reservations (1.3). |
| 4-12 | **Dynamic team sizing ship** | Claude Code adaptive size; claw-code `expand_team_mode` | L | default-local | Sprint 5.21 (`DESIGN_TEAMS_AND_SIZES.md`). |
| 4-13 | **Voice/realtime agents** | OpenAI RealtimeAgent (`gpt-realtime-2.1`) | XL | opt-in-remote | Low priority for a coding harness; **consider BY-DESIGN-OUT for v1.0**. |

---

## 5. Focused evaluations

### 5a. Web dashboard pattern (localhost-first control planes)

**2026 references:** OpenHands **Agent Canvas** (self-hosted developer control center;
runs OpenHands/Claude Code/Codex/Gemini or any ACP agent across local/remote/cloud
backends; local-first by default), CrewAI **AMP Suite** (commercial tracing +
unified control plane + on-prem/cloud), radcode `web/` (mirrors the TUI state over a
web UI), LangSmith (observability for LangGraph).

**Verdict for ithacus:** The pattern that fits is **localhost-first, reads the same
event stream as the overlay, zero external CDN/JS deps**. That is exactly Sprint 5.12
(loopback HTTP serving `dashboard.json` + `events.log`, Node builtins only) composed
with Sprint 5.20 (one typed event bus, many views). **Do NOT** rebuild as a heavy
cloud SPA — that violates PREVENT-ITH-004 and the local-enterprise positioning.

> Per `CLAUDE.md` task #25, the (separately-named) pi-mega-compact project is scrubbed
> from this repo; its references are intentionally omitted. The dashboard pattern is
> evaluated here via the category leaders above.

### 5b. Tailscale / mesh networking for agent fleets

**2026 references:** Tailscale **mesh networking** (every node connects directly over
WireGuard; no central VPN server; encrypted; NAT traversal; tailnet ACLs; auth keys;
ephemeral nodes) and **Aperture: Secure AI** (Set up LLM clients · Set up LLM
providers · Connectors · **Control AI access** · **Manage AI spending** · **Observe
and export AI usage**).

**Verdict for ithacus:** This is the strongest answer to "secure mesh networking
between agent machines." A fleet of pi machines, each running ithacus, joins a
tailnet; the **Sprint 5.9 A2A adapter runs over the tailnet**; **Aperture governs
which agents may reach which LLM providers and caps spend**. Two-tier model:
single-machine (default-local, no network) → opt-in tailnet (annotated exception,
default-OFF). Candidate **4-2**. This keeps ithacus local-first while enabling true
fleet operation — and satisfies the user's explicit ask without breaking
PREVENT-ITH-004.

### 5c. A2A protocol adoption specifics (Sprint 5.9)

**Current protocol shape** (from `a2a-protocol.org/latest/specification` + `a2aproject/A2A`, Apache-2.0, Linux Foundation):

- **Transport:** JSON-RPC 2.0 over HTTP(S) (primary binding, §9). gRPC (§10) and
  HTTP+JSON/REST (§11) bindings also exist — ** ithacus should implement the JSON-RPC
  HTTP binding only for 5.9; defer gRPC**.
- **Discovery:** **Agent Cards** at `/.well-known/agent.json` (`AgentCard`:
  name/description/url/provider/version/capabilities/skills/defaultInputModes/
  securitySchemes/security). `GetExtendedAgentCard` for authenticated capabilities.
  Optional **`AgentCardSignature`** (canonicalization + signature verification) for
  trust.
- **Task model:** `Task` + `TaskStatus` + `TaskState` (submitted, working,
  input-required, completed, canceled, failed, rejected, auth-required, unknown).
  `Message`/`Role`(user/agent)/`Part`(text/file/data)/`Artifact`.
- **Streaming:** SSE via `SendStreamingMessage` + `SubscribeToTask`; events
  `TaskStatusUpdateEvent`, `TaskArtifactUpdateEvent` (§4.2, §5.2).
- **Async:** Push notifications (`PushNotificationConfig` + `AuthenticationInfo` +
  `PushNotificationPayload`, §4.3/§5.3) for long-running tasks.
- **Auth:** `SecurityScheme` = `APIKey`, `HTTPAuth` (bearer/basic), `OAuth2`
  (AuthorizationCode/ClientCredentials/DeviceCode flows), `OpenIdConnect`,
  `MutualTls` (§4.5). Server identity verification + client authentication +
  in-task authorization (§7).
- **Multi-tenancy, extensions, custom bindings** (§6, §12) — extensible.

**Recommendation for 5.9 (matches `GAP_ANALYSIS_RADCODE_WORKFLOW.md` §"network-gated"):**
1. Implement **JSON-RPC HTTP binding + AgentCard discovery + SSE streaming** first
   (highest value, lowest complexity).
2. Map ithacus types → A2A: `ith_inbox` message ↔ `Message`/`Part`; swarm task ↔
   `Task`/`TaskState`; `synthesis` result ↔ `Artifact`; `negotiation` ↔ task
   delegation.
3. Keep it **opt-in, default-OFF**, localhost/A2A-server scope, with
   `// guardrails-allow PREVENT-ITH-004` annotations (same pattern as `search.ts`).
4. Reuse the `DispatchBackend` trait suggested in `RESEARCH_EXTERNAL_SOURCES.md`
   (radcode `Backend` pattern) so 5.9 is a swap, not a rewrite.
5. Note: ADK and MAF already expose A2A servers — ithacus can federate with them
   out of the box once 5.9 lands.

### 5d. Permission models worth borrowing

| Pattern | Source | Adopt in ithacus? |
|---|---|---|
| **PermissionMode** (read-only / workspace-write / full-access) + tool allowlists | Claude Code subagents (`--tools`), ithacus already ships this (5.15) | **Already OWNED** — keep |
| **Messages between agents are untrusted input** (a teammate can't relay an approval or bypass a check) | Claude Code agent teams (auto-mode classifier) | **Borrow** → candidate 4-4 |
| **Hook quality gates** (exit code 2 blocks task completion) | Claude Code `TaskCompleted` hook | **Borrow** → candidate 4-4/4-5 |
| **Plan-approval before mutating** (lead approves teammate plan) | Claude Code agent teams | **Borrow** → candidate 4-5 (gate `writer`) |
| **Source-trust ceiling** (bundle < project < user precedence) | ithacus 5.15 `extension-trust.ts` | **OWNED** |
| **Guardrails (input/output validation)** | OpenAI Agents SDK | Already covered by RPV (1.4) + 5.15 |
| **Secret redaction in audit events** | ithacus 5.15 `redact.ts` | **OWNED** |

The single highest-value borrow is **relay-prevention**: today ithacus enforces
allowlists at spawn but does not model "an agent-relayed permission request is
untrusted." Adding that (4-4) closes a real escalation gap before v1.0.

---

## 6. Anti-patterns observed in 2026 solutions (avoid in ithacus)

| Anti-pattern | Where observed | ithacus mitigation |
|---|---|---|
| **Stub the dispatch loop** (mark items COMPLETED without dispatching) | memory-mcp `dispatch_swarm` no-op | ithacus swarm **actually spawns** (5.4 ✅). Never mark COMPLETED without a real child result. (Also a failure-registry lesson.) |
| **Embed compressed text for recall** (embeds base64 of compressed string → recall fails) | memory-mcp `compact_session` | 5.18 stores/embeds the **ORIGINAL**; compress only for storage display. |
| **Invert similarity score semantics** (FAISS cosine *distance* lower=better treated as *similarity*) | memory-mcp FAISS consumers | Be explicit: `similarity` (↑better) vs `distance` (↓better); document units. ithacus's token-overlap scoring must state direction. |
| **Truncate session IDs at a dash** → prefix collisions | memory-mcp session-ID normalization | Use real UUID validation; never truncate. ithacus `runId`/`slotId` are UUIDs. |
| **Heavy cloud SPA dashboard** (CDN/JS deps, external hosting) | generic vendor dashboards | 5.12 stays loopback + Node-builtins (PREVENT-ITH-004). |
| **Autonomous autoscaling fleets** (unbounded fan-out) | cloud platforms | Bounded concurrency cap (24, 5.21); retry replaces a slot, never adds capacity. |
| **Hosted control plane / cloud RAG** | Bedrock/Vertex | BY-DESIGN-OUT; local sqlite + in-process only. |
| **Build on a framework in maintenance mode** | AutoGen → MAF | Keep `src/` pi-agnostic + dependency-free (Node builtins) so ithacus isn't hostage to any upstream. |
| **Orphaned sessions / lost state on shutdown** | Claude Code agent teams (known: orphaned tmux, resumption limits) | ithacus persists to sqlite; cleanup on exit; no orphaned processes (worktree auto-clean). |
| **Silent reinterpretation of team size** (ambiguous per-role multiplier) | claw-code PR #3250 `expand_team_mode` | 5.21: size = explicit total slot count, never ambiguous multiplier. |
| **Retry reuses failed session** (context-window bug) | claw-code PR #4 | 5.17 rebuilds a **fresh** compacted child; never reuses the failed session. |

---

## 7. Recommendations (priority order for v1.0)

1. **Ship 5.12 dashboard + 5.20 event bus** (perception-critical, local-only, cheap).
2. **Ship the unshipped specs**: 5.16 (checkpoints), 5.17 (auto-compact/retry),
   5.18 (consolidation), 5.19 (named teams) — these are spec-complete and close
   PARTIAL rows.
3. **Land 5.9 A2A adapter** (opt-in, default-OFF) — the interop on-ramp; federate
   with ADK/MAF.
4. **Add relay-prevention + hook gates** (4-4/4-5) on top of 5.15 — close the
   escalation gap before enterprise adoption.
5. **Define the two-tier remote model** (default-local → opt-in tailnet + A2A) as
   the documented exception pattern for 5.9 and 4-2; keep PREVENT-ITH-004 honored
   via annotated opt-ins.
6. **Durable execution/time-travel** (4-6) as a v1.0 differentiator, sqlite-local.

---

## 8. References (external URLs)

- A2A Protocol spec — https://a2a-protocol.org/latest/specification/
- A2A repo (Linux Foundation, Apache-2.0) — https://github.com/a2aproject/A2A
- A2A README (Google origin) — https://raw.githubusercontent.com/google/A2A/main/README.md
- Google ADK 2.0 docs — https://google.github.io/adk-docs/ ; repo https://github.com/google/adk-python
- OpenAI Agents SDK — https://openai.github.io/openai-agents-python/ ; https://github.com/openai/openai-agents-python
- Claude Code subagents — https://docs.claude.com/en/docs/claude-code/sub-agents
- Claude Code agent teams — https://code.claude.com/docs/en/agent-teams
- LangGraph — https://github.com/langchain-ai/langgraph ; https://docs.langchain.com/oss/python/langgraph/overview
- CrewAI — https://github.com/crewAIInc/crewAI ; AMP Suite https://crewai.com/amp
- Microsoft Agent Framework — https://github.com/microsoft/agent-framework ; https://learn.microsoft.com/en-us/agent-framework/
- AutoGen (maintenance mode) — https://github.com/microsoft/autogen
- smolagents — https://github.com/huggingface/smolagents ; https://huggingface.co/docs/smolagents
- MetaGPT — https://github.com/geekan/MetaGPT ; https://mgx.dev/
- CAMEL — https://github.com/camel-ai/camel
- MCP specification 2025-06-18 — https://modelcontextprotocol.io/specification/2025-06-18
- MCP authorization (OAuth 2.1) — https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- AWS Bedrock Agents / AgentCore — https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html
- Vertex AI Agent Engine / Gemini Enterprise Agent Platform — https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/overview
- OpenHands (Agent Canvas) — https://github.com/All-Hands-AI/OpenHands ; https://docs.openhands.dev
- Goose (AAIF/Linux Foundation) — https://github.com/block/goose ; https://goose-docs.ai
- Tailscale mesh networking — https://tailscale.com/kb/1132/mesh-networking
- Tailscale Aperture: Secure AI — https://tailscale.com/kb/ (section "Aperture: Secure AI": Set up LLM clients / providers, Control AI access, Manage AI spending, Observe and export AI usage)

**Internal (cross-referenced):** `docs/GAP_ANALYSIS_RADCODE_WORKFLOW.md`,
`docs/RESEARCH_EXTERNAL_SOURCES.md`, `docs/DESIGN_TEAMS_AND_SIZES.md`,
`docs/SPRINT_PLAN.md`, `docs/DESIGN_PERMISSION_MODES.md`, `docs/DESIGN_WORKER_STATUS.md`,
`docs/DESIGN_LIVE_PROGRESS.md`, `docs/DESIGN_EVENT_STREAM.md`, `docs/DESIGN_MEMORY_CONSOLIDATION.md`,
`docs/DESIGN_CHECKPOINT_MANAGER.md`, `docs/DESIGN_AUTO_COMPACT_RETRY.md`, `docs/DESIGN_TEAMS_CRONS.md`,
`docs/DESIGN_AGENT_BUNDLES.md`.

---

*Prepared by the ithacus research/plan agent. All external claims cite primary
2025–2026 sources; all ithacus status claims cite in-repo sprint/design docs. No
files outside `docs/` were created or modified for this analysis.*
