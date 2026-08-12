# Sprint 5.27 — Live-Card Overlay UX + Web Interface Toggle Surface (Default-On Flags)

**Status**: 📋 SPEC READY · **Captured**: user reports 2026-08-11
**Tier**: default-local (Tier L) — no network beyond loopback web serving
**Depends on**: Sprint 5.24 commit (in-flight; 2 deliverables outstanding)

## 1. User reports (verbatim intent)

1. "The popup window is not staying up, and it's not centering on the
   screen."
2. "We should have size toggles, and hide and resume toggles."
3. "Everything should be default flag on, with opt out in the web
   interface, which if we don't have we need to do."

## 2. Root-cause findings (verified in code)

**Why it doesn't float/center/stay up:** `extensions/ithacus-dispatch.ts:192`
renders the live card as a plain inline custom block —
`ctx.ui.custom(render, { component })` — with **no** `overlay: true` and no
`overlayOptions`. pi's TUI natively supports overlays (docs/tui.md):
`overlayOptions: { anchor: "center", width, maxHeight, margin, visible() }`
plus an `onHandle` API — `handle.focus()`, `handle.unfocus()`,
`handle.setHidden(bool)`, `handle.hide()`. Inline custom blocks get pushed by
message flow, which is exactly the "not staying up" symptom; centering is
impossible without overlay mode.

**Why there's no hide/resume:** no `onHandle` wiring exists. Only the
5.13.1 width toggle exists (`card_width: auto|fixed` in `ith_kv`,
`/ithacus-live width`).

## 3. Deliverables

### 3.1 Overlay rendering (fixes staying-up + centering)

- Switch card rendering in `extensions/ithacus-dispatch.ts` (and any other
  `ctx.ui.custom` live-card caller) to
  `ctx.ui.custom(render, { component, overlay: true, overlayOptions: {...} })`
  with `anchor: "center"`, `maxHeight: "70%"`, margin 1, and a `visible()`
  callback hiding the overlay on terminals narrower than 60 cols.
- Keep `nonCapturing` semantics (card never steals input).

### 3.2 Size toggles

- `/ithacus-live size [small|medium|large|next]` — cycles 50 / 76 / min(118,
  termWidth-4). Persisted in `ith_kv` key `card_size`; falls back to legacy
  `card_width` when unset. The card's `component.width` getter reads it.

### 3.3 Hide / resume toggles

- `/ithacus-live hide` → `handle.setHidden(true)`; `/ithacus-live show` →
  `handle.setHidden(false)`. Persisted in `ith_kv` key `card_hidden` and
  restored on session start. `onHandle` must store the handle in the
  runtime state (`extensions/ithacus-runtime.ts`) so commands can reach it.

### 3.4 Web interface (pulls forward Sprint 5.23 core — "we need to do")

Per `docs/DESIGN_WEB_INTERFACE.md`: loopback-only `node:http` server
(`extensions/ithacus-web.ts`, bind 127.0.0.1, port `ITHACUS_WEB_PORT`
default 7447), SSE fed from `runtime.eventBus`, bundled static assets in
`extensions/web/` (vanilla JS, no CDN). Views: Dashboard, Live, Inbox,
Guardrails (read-only), and the **Setup panel** — the opt-out surface.

### 3.5 Default-ON feature flags with opt-out

- New `UiFlags` in `src/config.ts` (same resolution pattern Sprint 5.24 used
  for `RemoteCapabilities`: env > project config > defaults):
  `{ liveCard: true, webUi: true, widget: true, menuOverlay: true, notifications: true }`
- All **default ON**. Opt-out via env (`ITHACUS_UI=liveCard:false,...`) or
  project config `.ithacus/config.json` `ui` key; the web Setup panel
  writes the same `ui` key (checkboxes).
- **Tier R remote capabilities stay default-OFF** — Sprint 5.24 policy is
  unchanged; only local UI flags default on.

## 4. Tests

- smoke-src: `UiFlags` resolution matrix (defaults all-on; config opt-out;
  env opt-out; malformed keys rejected — mirrors the 5.24 capability tests).
- smoke-ext: overlay options shape (anchor/center, maxHeight), toggle
  persistence round-trip via `ith_kv`, web server binds loopback only and
  refuses non-loopback binds.
- Manual: card floats centered, survives new messages, hide → show restores.

## 5. Sequencing

1. Sprint 5.24 completion commit (prerequisite; uncommitted writer changes
   in tree: config.ts / guardrails-scan.mjs / pattern-rules.json /
   extensions/opt-in/gate.ts).
2. §3.1–3.3 overlay + toggles (immediate UX pain; no new surfaces).
3. §3.4–3.5 web interface + default-on flags (uses the 5.24 config pattern).

## 6. Guardrails

- PREVENT-ITH-004 honored: web serving is loopback `node:http` (local);
  bundled assets, no CDN. Tier R untouched.
- No agent *control* from the web in v1 — observe + configure only.
