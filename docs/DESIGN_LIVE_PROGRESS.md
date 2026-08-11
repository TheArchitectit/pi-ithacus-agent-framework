# Design: ithacus Live-Progress Overlay

> **Status**: DRAFT — pending implementation (post-v0.3.15).
> **Sprint**: Sprint 5.13 (proposed) — Live-Progress Overlay.
> **Depends on**: Sprint 5.10 (dispatch tool ✅), Sprint 5.11 (menu overlay ✅).
> **Mission fit**: "different agents with different models to do task work" —
> the user must be able to SEE each agent's real-time activity, not just the
> final result.

---

## 1. The problem

ithacus v0.3.15 dispatches sub-agents correctly, but the user sees only:
1. `ithacus — explore · deepseek-v4-flash` / `✓ done` (the `emit()` onUpdate
   text — a flat 2-line status, no detail).
2. A green tool-result card AFTER completion (pi's native rendering).

**Missing** (the user's explicit request): per-agent real-time status with
**TPS, files being accessed, tool calls, token usage** — visible WHILE the
agent runs, not after.

v0.3.11–v0.3.15 tried to show a **static terminal-state popup AFTER**
`spawnAgent()` completed. This was fundamentally wrong:
- The popup showed only `✓ success` / `✗ failed` — never live "running" state.
- `ctx.ui.custom({ overlay: true })` called after `await spawnAgent` meant
  the overlay appeared (or didn't — see v0.3.14 silent-failure bug) only
  once the work was already done.
- The `onUpdate` emit text carried live progress, but as flat escaped text
  (no theme colors, no box, no structure) — it blended into the chat stream.

**The pi platform DOES support overlays during tool execution** (verified
by explorer agent 2: `compositeOverlays` runs every frame regardless of
streaming/busy state; `nonCapturing` overlays are still rendered; no
`toolRunning`/`isBusy` gate in the `custom` → `showExtensionCustom` →
`showOverlay` → `compositeOverlays` path). So a live overlay DURING the
dispatch is achievable.

---

## 2. The reference pattern (studied, not copied)

pi-messenger (`github.com/nicobailon/pi-messenger`) solves this with a
**module-level live-progress store + a persistent overlay component**:

```
crew/live-progress.ts:
  liveWorkers: Map<key, LiveWorkerInfo>
  listeners: Set<() => void>
  updateLiveWorker() / removeLiveWorker() / onLiveWorkersChanged()

crew/utils/progress.ts:
  AgentProgress { agent, status, currentTool, currentToolArgs,
                 recentTools[], toolCallCount, tokens, durationMs }
  updateProgress(progress, event, startTime) — parses pi --mode json events:
    tool_execution_start → currentTool + args preview
    tool_execution_end   → push recentTools, increment count
    message_end          → accumulate token usage

config-overlay.ts:
  class implements Component, Focusable {
    readonly width = 60; focused = false;
    render() → bordered box with theme.fg("dim", border), visibleWidth padding
  }
```

ithacus adopts the **architecture** (module store + persistent overlay +
JSON event parsing) but implements its **own look, data model, and fields**:

| Aspect | pi-messenger | ithacus (this design) |
|---|---|---|
| Width | 60 | 52 (matches `/ithacus-menu`) |
| Layout | title + folder list + help | em-dash title + TPS/files/tokens/timer rows |
| Unique fields | (none) | **TPS** (tokens/sec) + **files accessed** list |
| Identity | "Messenger Config" | `ithacus — <role>` (em-dash, matches menu) |
| Colors | dim borders, accent title | dim borders, accent title/model, success/error status, muted meta |
| Store key | `cwd::taskId` | `dispatchId` (simpler — one overlay per active dispatch) |

---

## 3. Architecture

Three new pieces, all in `extensions/` (pi-adapter layer — they parse pi's
JSON output and use pi's Component API, so they're NOT pi-agnostic):

```
extensions/ithacus-live.ts      (NEW — module-level store + JSON event parser)
extensions/ithacus-live-card.ts (NEW — persistent overlay Component)
extensions/ithacus-dispatch.ts  (EDITED — wire live overlay into execute())
```

### 3.1 Live-progress store (`extensions/ithacus-live.ts`)

Module-level mutable store + listener pattern (like pi-messenger's
`liveWorkers`, but simpler — keyed by a single `dispatchId` string):

```ts
export interface LiveToolEntry {
  tool: string;        // e.g. "read", "edit", "bash"
  args: string;        // preview: path / command / pattern (truncated to 60)
  startMs: number;
  endMs?: number;
}

export interface AgentLive {
  agent: string;                          // "explore" | "plan" | ...
  model?: string;
  status: "running" | "success" | "failed";
  currentTool?: string;
  currentToolArgs?: string;
  recentTools: LiveToolEntry[];           // last N (cap 5, ring buffer)
  toolCallCount: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  filesAccessed: string[];                // unique file paths (cap 8)
  startedAt: number;
  error?: string;
}

const live = new Map<string, AgentLive>();
const listeners = new Set<() => void>();

export function startLive(id: string, agent: string, model?: string): void;
export function updateLive(id: string, event: PiJsonEvent, startTime: number): void;
export function endLive(id: string, success: boolean, error?: string): void;
export function removeLive(id: string): void;
export function getLive(id: string): AgentLive | undefined;
export function onLiveChanged(fn: () => void): () => void;  // unsubscribe
```

**JSON event parsing** (zero-dep — no pi-tui import, PREVENT-ITH-004):

```ts
// pi --mode json emits JSONL events. We parse the 3 event types that matter:
//   tool_execution_start: { toolName, args: { command, path, file_path, pattern, query } }
//   tool_execution_end:   { toolName, args }
//   message_end:          { message: { usage: { input, output, cacheRead }, model } }

export function parseJsonlLine(line: string): PiJsonEvent | null {
  if (!line.trim()) return null;
  try { return JSON.parse(line); } catch { return null; }  // tolerate partial lines
}
```

**TPS computation** (ithacus's unique addition):
```ts
function tps(tokensOut: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  return tokensOut / (durationMs / 1000);
}
```

**File extraction** (ithacus's unique addition):
```ts
const FILE_ARG_KEYS = ["path", "file_path", "pattern", "query"];
function extractFile(args?: Record<string, unknown>): string | null {
  if (!args) return null;
  for (const k of FILE_ARG_KEYS) {
    if (typeof args[k] === "string" && (args[k] as string).length > 0) {
      return (args[k] as string).split("\n")[0].slice(0, 80);  // preview
    }
  }
  return null;
}
```

### 3.2 Live overlay component (`extensions/ithacus-live-card.ts`)

A real pi `Component` + `Focusable` (structural — `render`/`handleInput`/
`invalidate`/`dispose` + `readonly width` + `focused`). Shown at dispatch
**START** (before `await spawnAgent`), reads from the store, re-renders on
each `onLiveChanged` callback.

```ts
export class IthLiveCard {
  readonly width = 52;
  focused = false;

  private t: ThemeLike;
  private dispatchId: string;
  private requestRender: () => void;
  private unsub: (() => void) | null = null;
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  private handle: { hide(): void } | null = null;
  private done: (v: null) => void;
  private dismissed = false;

  constructor(theme, dispatchId, done, requestRender) {
    this.t = theme ?? NO_THEME;
    this.dispatchId = dispatchId;
    this.done = done;
    this.requestRender = requestRender;
    // Subscribe to store changes — re-render on every update.
    this.unsub = onLiveChanged(() => this.safeRender());
  }

  setHandle(handle) { this.handle = handle; }

  private safeRender(): void {
    try { this.requestRender(); } catch { /* TUI not ready */ }
  }

  invalidate(): void {}

  dispose(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    if (this.autoHideTimer) { clearTimeout(this.autoHideTimer); this.autoHideTimer = null; }
  }

  /** Called by onHandle or when the dispatch completes — flip to terminal
   *  state, hold for 3s, then auto-dismiss. */
  markDone(): void {
    // Will render success/failed based on store status.
    this.safeRender();
    this.autoHideTimer = setTimeout(() => this.dismiss(), 3000);
  }

  private dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    try { this.handle?.hide(); } catch {}
    try { this.done(null); } catch {}
  }

  handleInput(_data: string): void { this.dismiss(); }  // best-effort (nonCapturing won't receive)

  render(_width: number): string[] {
    // DEFENSIVE: never crash the host TUI (v0.3.12 lesson).
    try {
      const live = getLive(this.dispatchId);
      if (!live) return [`ithacus — dispatch`];
      // ... bordered box render (see §4 for exact layout)
    } catch {
      return [`ithacus — ${this.t.fg("muted", live?.agent ?? "dispatch")}`];
    }
  }
}
```

### 3.3 execute() wiring (`extensions/ithacus-dispatch.ts`)

The `execute()` body changes from "spawn then pop a terminal popup" to
"show live overlay, drive it from spawn progress, then mark done":

```ts
async execute(toolCallId, params, signal, onUpdate, ctx) {
  const agentType = params.agent ?? "explore";
  const dispatchId = `${toolCallId}-${Date.now()}`;
  const taskPreview = params.task.slice(0, 80) + (params.task.length > 80 ? "…" : "");

  // 1. Register in the live store (so the overlay has data).
  startLive(dispatchId, agentType, params.model);

  // 2. Show the overlay IMMEDIATELY (before spawnAgent). Fire-and-forget —
  //    don't await (v0.3.15 lesson: awaiting blocks the tool return).
  let cardRef: IthLiveCard | null = null;
  try {
    ctx.ui.custom<null>(
      (_tui, theme, _kb, done) => {
        cardRef = new IthLiveCard(theme, dispatchId, done, () => _tui.requestRender());
        return cardRef;
      },
      {
        overlay: true,
        overlayOptions: { width: 52, nonCapturing: true, anchor: "top-center", offsetY: 1 },
        onHandle: (handle) => {
          cardRef?.setHandle(handle);
        },
      },
    ).catch(() => { /* best-effort — never block the tool result */ });
  } catch { /* ctx.ui.custom unavailable in headless mode */ }

  // 3. Spawn the sub-agent. The onProgress callback parses JSON events
  //    and feeds the store → the overlay re-renders live.
  let res;
  try {
    res = await spawnAgent({
      ...,
      onProgress: (info) => {
        // Parse the raw JSON line (spawnAgent must pass through --mode json
        // stdout lines as `info.rawJsonLine` — see §5 spawnAgent change).
        if (info.rawJsonLine) {
          const event = parseJsonlLine(info.rawJsonLine);
          if (event) updateLive(dispatchId, event, startTime);
        }
        // Keep the existing emit() for the flat text fallback.
        emit(...);
      },
    });
  } finally {
    // 4. Mark the store terminal, flip the overlay to done state.
    endLive(dispatchId, res?.success ?? false, res?.error);
    cardRef?.markDone();
    runtime?.dispatchEnded(agentType);
  }

  // 5. Return the clean text result (unchanged from v0.3.15).
  return { content: [...], details: {...} };
}
```

---

## 4. Overlay render layout

ithacus's own bordered-box look (consistent with `/ithacus-menu`'s visual
language — em-dash title, aligned label columns, accent model, muted meta):

```
╭── ithacus — explore · deepseek-v4 ──────╮
│                                          │
│  status   ⟳ running · 12.4s · 68 tps     │
│  tokens   847 in · 412 out               │
│  tool     read (package.json)            │
│  calls    4 tools · 2 files              │
│  files    CLAUDE.md, package.json, …      │
│  task     read CLAUDE.md and report ba…   │
│                                          │
╰──────── auto-dismiss when done ──────────╯
```

**On completion** the `status` row flips to:
- `✓ success · 8.2s · 102 tps` (theme `success`)
- `✗ failed (exit 1) · 8.2s` (theme `error`)

**Color rules** (valid pi theme tokens ONLY — v0.3.13 lesson):
- borders: `theme.fg("dim", …)`
- title text: `theme.fg("accent", …)`
- model: `theme.fg("accent", …)`
- status running: `theme.fg("accent", …)`
- status success: `theme.fg("success", …)`
- status failed: `theme.fg("error", …)`
- meta (tokens, files, task): `theme.fg("muted", …)`

**Alignment**: `padEnd(7)` label column (matches `/ithacus-menu`). Uses
zero-dep `visibleWidth` (ANSI-aware) for padding — never import from pi-tui
(PREVENT-ITH-004: zero runtime deps).

**Truncation**: `truncateToWidth(s, maxW)` (zero-dep) for long paths/tasks.

---

## 5. spawnAgent change (pass-through JSON lines)

`spawnAgent` currently captures stdout and parses it post-hoc for
`capturedModel`. It needs to emit **raw JSONL lines** as they arrive via
`onProgress`, so the live store can parse them in real time:

```ts
// In spawnAgent's stdout.on("data") handler, when --mode json is active:
//   split the buffer on newlines, for each complete line:
//     onProgress?.({ phase: "json", rawJsonLine: line, model: capturedModel });
```

This is a **small, backward-compatible change**: `onProgress` gains an extra
field (`rawJsonLine?: string`). The existing `phase: "tool" | "text" |
"message_end"` parsing stays as a fallback for non-JSON mode.

**Guard**: `--mode json` must be added to the child `pi` spawn args. When
active, the child emits structured JSONL events instead of prose. The
existing stdout-capture-for-output still works (we accumulate the assistant's
final text from `message_end` events).

---

## 6. Guardrails compliance

| Rule | Compliance |
|---|---|
| PREVENT-ITH-001 | N/A (no message trimming in this feature) |
| PREVENT-ITH-002 | N/A (no trim boundaries) |
| PREVENT-ITH-003 | N/A (no system-role context injection) |
| PREVENT-ITH-004 | ✅ Zero runtime deps. `visibleWidth`/`truncateToWidth`/`parseJsonlLine` are zero-dep (no pi-tui import). No `node:http`/`net`. `node:child_process` already annotated (existing PREVENT-ITH-004 exception for local-pi-subprocess-dispatch). |
| PREVENT-DIST-001 | ✅ Ships via `npm publish` only (deploy.sh pipeline). |
| src/ pi-agnostic | ✅ All new code in `extensions/` (pi-adapter layer — parses pi JSON, uses pi Component API). `src/` untouched. |
| Valid theme colors | ✅ Only `accent`, `success`, `error`, `muted`, `dim` (v0.3.13 lesson — `green`/`red` crash pi). |
| No parameter properties | ✅ All constructor fields declared explicitly (v0.3.11 lesson — strip-only mode rejects `constructor(private x: T)`). |
| Defensive render() | ✅ Entire `render()` wrapped in try/catch, degrades to plain text (v0.3.12 lesson — never crash the host TUI). |
| File size guardrail | ✅ `ithacus-live.ts` ≤ 250 lines, `ithacus-live-card.ts` ≤ 300 lines, `ithacus-dispatch.ts` stays ≤ 400 (split if needed). |
| Fire-and-forget overlay | ✅ `ctx.ui.custom` NOT awaited (v0.3.15 lesson — awaiting blocks the tool return). |
| `nonCapturing: true` | ✅ Shows visually without stealing keyboard focus during tool execution. |
| Store cleanup | ✅ `removeLive(id)` called on dismiss; `dispose()` unsubscribes listeners (no leak). |

---

## 7. What's distinct from pi-messenger (not a copy)

1. **TPS field** — ithacus computes tokens/sec (pi-messenger doesn't).
2. **Files accessed list** — ithacus tracks unique file paths touched (pi-messenger doesn't).
3. **Single dispatch key** — ithacus uses `dispatchId` (one overlay per active dispatch), not pi-messenger's `cwd::taskId` multi-worker map.
4. **Visual identity** — width 52 (not 60), em-dash title `ithacus — <role>` (not "Messenger Config"), ithacus's aligned label columns + color hierarchy matching `/ithacus-menu`.
5. **No task/plan/store coupling** — ithacus's live store is a thin progress surface, not tied to a task-claiming/sprint system. ithacus's orchestration stays in `src/`.

---

## 8. Acceptance criteria

- [ ] `npm run gate` green (build + lint + smoke + guardrails + regression + semantic + schema-health).
- [ ] Dispatching `ithacus-dispatch` shows a bordered overlay at the top-center of the screen IMMEDIATELY (before the sub-agent finishes).
- [ ] The overlay shows live-updating: status (running), duration (ticking), current tool + args, tool call count, token counts, TPS, files accessed.
- [ ] On completion, the overlay flips to `✓ success` / `✗ failed` and auto-dismisses after 3s.
- [ ] The overlay never crashes pi (defensive render, valid theme colors, no parameter properties).
- [ ] `extensions/ithacus-live.ts` + `extensions/ithacus-live-card.ts` pass smoke tests (loadable in strip-only mode).
- [ ] Zero new runtime dependencies (PREVENT-ITH-004).
- [ ] `src/` untouched (pi-agnostic layer preserved).
- [ ] Deployed via `./scripts/deploy.sh` (PREVENT-DIST-001 — npm publish only).

---

## 9. Risks & unknowns

1. **`--mode json` child arg**: must verify pi accepts `--mode json` and emits the expected JSONL event schema (`tool_execution_start`/`end`, `message_end` with `usage`). If the schema differs, `parseJsonlLine` + `updateLive` need adjustment. **Mitigation**: test with a real dispatch early; fall back to the existing `onProgress` phase-based emit if JSON parsing yields nothing.
2. **Overlay during streaming**: verified by explorer agent 2 that `compositeOverlays` runs every frame regardless of streaming state. But visual overlap with streaming chat output is possible — `anchor: "top-center", offsetY: 1` positions it above the editor, minimizing overlap.
3. **Silent failure**: if `ctx.ui.custom` throws or rejects (headless mode, non-TUI), `.catch(() => {})` swallows it. The flat `emit()` text + final tool-result card still carry the info — the overlay is enhancement, not critical path.
4. **Multi-dispatch**: if the user dispatches multiple agents concurrently, multiple overlays would stack. ithacus keys by `dispatchId` so each has its own card, but they'd visually overlap. **Mitigation**: for v0.3.16, accept overlap (last-dispatch-wins via `focusOrder`); future work could aggregate into a single multi-agent card.
5. **`onHandle` not firing**: if pi doesn't invoke `onHandle` for a `nonCapturing` overlay, `setHandle` never runs and `handle.hide()` can't dismiss. **Mitigation**: `markDone()` schedules its own 3s `dismiss()` timer (uses `done(null)` as fallback if `handle` is null — `done()` resolves the `ctx.ui.custom` promise which also removes the overlay).

---

## 10. Sprint placement

Add as **Sprint 5.13 — Live-Progress Overlay** in `docs/SPRINT_PLAN.md`
(after Sprint 5.12 Local Web Dashboard). Builds on Sprint 5.10 (dispatch
tool) + Sprint 5.11 (menu overlay — the Component pattern reference).

**Estimate**: 1 week. Three new files, one edited file, one small spawnAgent
change. No `src/` changes. No new deps.
