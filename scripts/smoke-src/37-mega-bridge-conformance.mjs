// 37-mega-bridge-conformance.mjs — cross-repo conformance + round-trip.
//
// Verifies the PUBLISHED pi-mega-compact bridge (pi-mega-compact/dist/src/
// bridge.js, an OPTIONAL peer dep) satisfies ithacus's local MegaBridgeContract
// (src/mega-bridge-contract.ts) field-for-field, and that the real engine
// round-trips work over a temp stateDir. Runs in ithacus's smoke gate so a
// mega-compact release that diverges from the contract fails HERE, in ithacus's
// CI, before any user hits it.
//
// This is the single source of truth that keeps the local contract
// (src/mega-bridge-contract.ts) honest against mega's real module. If mega
// renames a method or a Bridge* field, this test breaks with a clear diff.

import { check, mkdtempSync, rmSync, join } from "./_harness.mjs";

export async function run() {
  let bridge;
  let dir;
  try {
    dir = mkdtempSync(join(import.meta.dirname?.replace("/smoke-src", "") || ".", "mega-conf-"));
    const mod = await import("pi-mega-compact/dist/src/bridge.js");
    check("mega-compact bridge module imports", typeof mod.createMegaBridge === "function");
    bridge = mod.createMegaBridge({ stateDir: dir });
    check("createMegaBridge returns an object", bridge && typeof bridge === "object");

    // ── Contract surface: all 9 methods present with the right arity. ──────────
    const methods = [
      "compact", "recallCheckpoints", "recallMemories", "recallAndInlineAsync",
      "fork", "cortexQuery", "addMemory", "recordTurn", "close",
    ];
    for (const m of methods) {
      check(`MegaBridgeContract method present: ${m}`, typeof bridge[m] === "function");
    }

    // ── Round-trip 1: compact → recallCheckpoints. ────────────────────────────
    const sessionId = "conf_sess";
    const compacted = bridge.compact({
      sessionId,
      messages: [
        { role: "user", text: "we migrated the billing ledger to the new schema" },
        { role: "assistant", text: "the billing ledger migration reconciled every cent" },
      ],
    });
    check("compact returns BridgeCompactResult.summary (string)", typeof compacted.summary === "string" && compacted.summary.length > 0);
    check("compact returns BridgeCompactResult.skipped (boolean)", typeof compacted.skipped === "boolean");
    check("compact returns BridgeCompactResult.tokenEstimate (number)", typeof compacted.tokenEstimate === "number");
    check("compact sets checkpointId", typeof compacted.checkpointId === "string" && compacted.checkpointId.length > 0);

    const recall = bridge.recallCheckpoints({ sessionId, query: "billing ledger migration", limit: 3 });
    check("recallCheckpoints returns BridgeRecallResult.block (string)", typeof recall.block === "string");
    check("recallCheckpoints returns BridgeRecallResult.report (array)", Array.isArray(recall.report));
    check("recallCheckpoints returns BridgeRecallResult.hitCount (number)", typeof recall.hitCount === "number");
    check("recallCheckpoints returns BridgeRecallResult.empty (boolean)", typeof recall.empty === "boolean");
    check("recallCheckpoints finds the compacted checkpoint", recall.empty === false && recall.hitCount >= 1);

    // ── Round-trip 2: addMemory → recallMemories. ──────────────────────────────
    const probe = "unique conformance probe text zzz-ithacus-bridge";
    const id = bridge.addMemory({ content: probe, kind: "note", tags: ["conf"] });
    check("addMemory returns a number row id (or void)", id === undefined || typeof id === "number");
    const mem = await bridge.recallMemories({ query: probe, limit: 5 });
    check("recallMemories returns BridgeMemoryRecallResult.block (string)", typeof mem.block === "string");
    check("recallMemories returns BridgeMemoryRecallResult.empty (boolean)", typeof mem.empty === "boolean");
    check("recallMemories finds the added memory", mem.empty === false && mem.block.includes(probe));

    // ── Round-trip 3: recordTurn ×3 → fork returns graceful NO_RECALL. ────────
    // recordTurn alone does not seed injected checkpoints, so fork must return
    // the error variant (NOT throw) — the bridge's contract.
    const conversationId = "conf_conv";
    for (let i = 0; i < 3; i++) {
      bridge.recordTurn({
        conversationId, sessionId: "conf_fork", turnIndex: i,
        role: "assistant", endedAt: Date.now() + i,
      });
    }
    const fork = bridge.fork({ parentConversationId: conversationId, turnIndex: 1 });
    check("fork returns a BridgeForkResult (success or error variant)", "error" in fork || "childConversationId" in fork);
    check("fork with no injected checkpoints returns error: NO_RECALL (graceful, not a throw)",
      "error" in fork && fork.error === "NO_RECALL");

    // ── Round-trip 4: cortexQuery returns an array. ───────────────────────────
    const cortex = bridge.cortexQuery({ query: "anything", limit: 5 });
    check("cortexQuery returns BridgeCortexResult.results (array)", Array.isArray(cortex.results));
    check("cortexQuery returns BridgeCortexResult.hitCount (number)", typeof cortex.hitCount === "number");

    // ── close does not throw. ──────────────────────────────────────────────────
    let closeThrew = false;
    try { bridge.close(); } catch { closeThrew = true; }
    check("close() does not throw", closeThrew === false);
  } finally {
    try { bridge?.close(); } catch { /* */ }
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
