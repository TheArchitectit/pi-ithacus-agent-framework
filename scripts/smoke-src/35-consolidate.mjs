// Sprint 5.18 — Memory Consolidation (DESIGN_MEMORY_CONSOLIDATION.md)
// Pure consolidate() pipeline (supersede → collapse → cluster), token-overlap
// scoring, dry-run purity, and the store applyConsolidation/recall roundtrip.
import {
  check, cfg, IthStore, tmpRepo, consolidate, hindsight, HindsightStore,
} from "./_harness.mjs";

// --- shared fixtures -------------------------------------------------------
const M = (id, text, ts, kind = "fact", extra = {}) =>
  ({ id, kind, text, repoId: "repo1", ts, ...extra });

export async function run(ctx) {
console.log("S35_RUN_ENTERED");
try {

// 1. tokenOverlap: symmetric, [0,1], higher = more similar.
{
  const a = "the auth module validates every request token";
  const b = "the auth module validates every incoming token";
  const c = "the billing pipeline invoices subscriptions nightly";
  const overlapAB = consolidate.tokenOverlap(a, b);
  const overlapAC = consolidate.tokenOverlap(a, c);
  check("tokenOverlap symmetric", overlapAB === consolidate.tokenOverlap(b, a));
  check("tokenOverlap identical text = 1", consolidate.tokenOverlap(a, a) === 1);
  check("tokenOverlap near-duplicates high (>0.7)", overlapAB > 0.7);
  check("tokenOverlap unrelated low (<0.5)", overlapAC < 0.5);
  check("tokenOverlap range [0,1]", overlapAB >= 0 && overlapAB <= 1 && overlapAC >= 0 && overlapAC <= 1);
  check("tokenOverlap empty returns 0", consolidate.tokenOverlap("", "a") === 0);
}

// 2. SUPERSEDE: marker + obsolete flag chain; newest obsolete self-tombstones.
{
  // A(obsolete marker) → B(obsolete flag) → C(active). Chain: A→B, B→C.
  const mems = [
    M("A", "old fact [superseded]", 100),
    M("B", "mid fact", 200, "fact", { obsolete: true }),
    M("C", "new fact", 300),
  ];
  const plan = consolidate.consolidate(mems);
  check("supersede marks 2 obsolete entries", plan.supersede.length === 2);
  const byId = Object.fromEntries(plan.supersede.map((s) => [s.id, s.supersededBy]));
  check("supersede chain A→B", byId.A === "B");
  check("supersede chain B→C", byId.B === "C");
  check("supersede keeps active entry (C not listed)", byId.C === undefined);
}

// 3. SUPERSEDE: newest obsolete with no replacement self-tombstones (own id).
{
  const mems = [M("D", "stale [superseded]", 100)];
  const plan = consolidate.consolidate(mems);
  check("supersede self-tombstone", plan.supersede.length === 1 && plan.supersede[0].supersededBy === "D");
}

// 4. COLLAPSE: near-duplicates within window merge into the NEWEST member.
{
  const mems = [
    M("c1", "the deploy uses blue-green rollback", 100),
    M("c2", "the deploy uses blue-green rollback", 200),
    M("c3", "the deploy uses blue-green rollback", 300),
    M("c4", "completely unrelated billing thing", 400),
  ];
  const plan = consolidate.consolidate(mems, { collapseThreshold: 0.75 });
  check("collapse one group (c1,c2,c3)", plan.collapse.length === 1);
  const g = plan.collapse[0];
  check("collapse mergedId is newest (c3)", g.mergedId === "c3");
  check("collapse members are older (c1,c2)", JSON.stringify(g.memberIds.sort()) === JSON.stringify(["c1", "c2"]));
  check("collapse leaves unrelated alone", !plan.collapse.some((x) => x.memberIds.includes("c4")));
}

// 5. COLLAPSE: threshold boundary — overlap below collapseThreshold stays apart.
{
  const mems = [
    M("t1", "the api rate limits to ten requests per second", 100),
    M("t2", "the api limits requests per second overall", 200),
  ];
  const plan = consolidate.consolidate(mems, { collapseThreshold: 0.95 });
  check("collapse high threshold splits apart", plan.collapse.length === 0);
  const planLow = consolidate.consolidate(mems, { collapseThreshold: 0.5 });
  check("collapse low threshold merges", planLow.collapse.length === 1);
}

// 6. COLLAPSE: window boundary — entries outside windowMs stay apart.
{
  const mems = [
    M("w1", "config lives in a yaml file", 100),
    M("w2", "config lives in a yaml file", 100 + 24 * 60 * 60 * 1000 + 1), // just past 24h
  ];
  const plan = consolidate.consolidate(mems, { collapseThreshold: 0.75, windowMs: 24 * 60 * 60 * 1000 });
  check("collapse outside window stays apart", plan.collapse.length === 0);
}

// 7. CLUSTER: similar remaining entries grouped; unique entries stay untagged.
{
  const mems = [
    M("k1", "the auth flow signs every jwt", 100),
    M("k2", "the auth flow verifies every jwt token", 200),
    M("k3", "the auth flow refreshes jwt secrets", 300),
    M("k4", "the billing runs nightly invoices", 400),
  ];
  const plan = consolidate.consolidate(mems, { clusterThreshold: 0.5, collapseThreshold: 1 });
  check("cluster one multi-member group (k1,k2,k3)", plan.cluster.length >= 1);
  const cl = plan.cluster.find((x) => x.memberIds.includes("k1"));
  check("cluster groups auth facts", !!cl && cl.memberIds.length === 3);
  check("cluster excludes singleton (k4)", !plan.cluster.some((x) => x.memberIds.includes("k4")));
}

// 8. Purity: consolidate() never mutates its input array.
{
  const mems = [M("p1", "the deploy uses blue-green [superseded]", 100), M("p2", "the deploy uses blue-green", 200)];
  const snap = JSON.stringify(mems);
  consolidate.consolidate(mems, { collapseThreshold: 0.9 });
  check("consolidate is pure (input unchanged)", JSON.stringify(mems) === snap);
}

// 9. Pipe isolation: superseded entries are NOT collapse/cluster candidates.
{
  const mems = [
    M("s1", "obsolete deploy note [superseded]", 100),
    M("s2", "obsolete deploy note [superseded]", 200),
    M("s3", "current deploy note", 300),
  ];
  // Even though s1,s2 are identical (would collapse), both are superseded →
  // excluded from collapse.
  const plan = consolidate.consolidate(mems, { collapseThreshold: 0.75 });
  check("superseded excluded from collapse", plan.collapse.length === 0);
  check("superseded excluded from cluster", plan.cluster.length === 0);
}

// 10. STORE: applyConsolidation roundtrip + recall filters superseded/collapsed.
{
  const store = new IthStore(tmpRepo, cfg.loadConfig());
  store.addMemory({ id: "r1", kind: "fact", text: "stale fact [superseded]", repoId: "r", ts: 100 });
  store.addMemory({ id: "r2", kind: "fact", text: "current fact", repoId: "r", ts: 200 });
  store.addMemory({ id: "r3", kind: "fact", text: "current fact duplicate", repoId: "r", ts: 300 });
  const rows = store.db.prepare(`SELECT id, kind, text, repoId, ts FROM ith_memories WHERE repoId = ?`).all("r");
  const plan = consolidate.consolidate(rows, { collapseThreshold: 0.75 });
  store.applyConsolidation(plan);
  check("supersede applied (r1 superseded_by set)", store.db.prepare(`SELECT superseded_by FROM ith_memories WHERE id='r1'`).get().superseded_by !== null);
  check("collapse applied (r2 collapsed_into r3)",
    store.db.prepare(`SELECT collapsed_into FROM ith_memories WHERE id='r2'`).get().collapsed_into === "r3");
  const rec = store.recall("r", undefined, 10);
  check("recall filters superseded (r1 gone)", !rec.some((m) => m.id === "r1"));
  check("recall filters collapsed (r2 gone)", !rec.some((m) => m.id === "r2"));
  check("recall keeps survivors (r3 present)", rec.some((m) => m.id === "r3"));
  const recAll = store.recall("r", undefined, 10, true);
  check("recall includeConsolidated shows all", recAll.length === 3);
  check("memoryCount counts active only", store.memoryCount("r") === 1);
  store.close();
}

// 11. HINDSIGHT recall also excludes superseded/collapsed rows.
{
  const store = new IthStore(tmpRepo, cfg.loadConfig());
  const hs = new HindsightStore(store.db);
  hs.retain({ id: "h1", repoId: "hr", agentId: "a", runId: "run", kind: "fact", text: "old [superseded]", relevance: 0.9, reflected: false, ts: 100 });
  hs.retain({ id: "h2", repoId: "hr", agentId: "a", runId: "run", kind: "fact", text: "new fact", relevance: 0.8, reflected: false, ts: 200 });
  store.db.prepare(`UPDATE ith_memories SET superseded_by='h2' WHERE id='h1'`).run();
  const got = hs.recall("hr");
  check("hindsight recall excludes superseded", got.length === 1 && got[0].id === "h2");
  store.close();
}

// 12. CONFIG: consolidation block present with safe defaults.
{
  const conf = cfg.loadConfig();
  check("config.consolidation exists", !!conf.consolidation);
  check("config.consolidation defaults",
    conf.consolidation.collapseThreshold === 0.75 &&
    conf.consolidation.clusterThreshold === 0.5 &&
    conf.consolidation.windowMs === 24 * 60 * 60 * 1000 &&
    conf.consolidation.autoThreshold === 500);
}

} catch (e) {
  console.log("CONSOLIDATE_MODULE35_THREW: " + (e?.message ?? String(e)) + " :: " + (e?.stack ?? "").split("\n").slice(0, 4).join(" | "));
}
}
