/**
 * consolidate.ts — memory consolidation pipeline (Sprint 5.18).
 *
 * Three pure, never-mutating passes over ith_memories rows:
 *   SUPERSEDE → COLLAPSE → CLUSTER
 * (the memory-mcp "Trident" compaction shape — CONCEPT borrowed only; no
 * pgvector/FAISS/Redis). Similarity is in-process token-overlap scoring in
 * [0,1] (higher = more similar) — no vector DB, no external embeddings
 * (PREVENT-ITH-004).
 *
 * consolidate() produces a dry-run ConsolidationPlan; the store applies it
 * only when the caller commits (IthStore.applyConsolidation). The input array
 * is NEVER mutated (PREVENT-ITH-001 spirit: nothing destructive without an
 * audit trail). Original text is never rewritten — consolidation only ADDS
 * superseded_by / collapsed_into / cluster_tag metadata.
 *
 * pi-agnostic: depends only on this module's own types.
 */

export type MemoryKind = "decision" | "fact" | "preference";

/** A memory row the consolidation pipeline operates on (superset of IthMemory). */
export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  repoId: string;
  ts: number;
  /** reflect() flagged this entry obsolete (or text carries a supersede marker). */
  obsolete?: boolean;
  supersededBy?: string | null;
  collapsedInto?: string | null;
  clusterTag?: string | null;
}

/** Tuning knobs for the pipeline. Every field optional — safe defaults below. */
export interface ConsolidateOptions {
  /** Token-overlap in [0,1]; entries at/above merge as near-duplicates. default 0.75. */
  collapseThreshold?: number;
  /** Token-overlap in [0,1]; entries at/above group into one recall cluster. default 0.5. */
  clusterThreshold?: number;
  /** Collapse time window in ms. default 24h. */
  windowMs?: number;
  /** Text substrings that mark an entry obsolete (supersede-eligible). default ["[superseded]"]. */
  supersedeMarkers?: string[];
}

/** One supersede action: mark `id` obsolete, superseded by `supersededBy` (own id = self-tombstone). */
export interface SupersedeEntry {
  id: string;
  supersededBy: string | null;
  reason: string;
}

/** One collapse action: merge `memberIds` into a single surviving entry `mergedId`. */
export interface CollapseEntry {
  mergedId: string;
  memberIds: string[];
}

/** One cluster action: tag `memberIds` with a synthetic centroid `tag` (recall speedup). */
export interface ClusterEntry {
  tag: string;
  memberIds: string[];
}

/** Dry-run artifact — the store applies it only on commit. */
export interface ConsolidationPlan {
  supersede: SupersedeEntry[];
  collapse: CollapseEntry[];
  cluster: ClusterEntry[];
}

/** Token overlap similarity (identical tokenization as hindsight scoreRelevance).
 *  Symmetric, in [0,1]; higher = more similar. */
export function tokenOverlap(a: string, b: string): number {
  const ta = terms(a);
  const tb = terms(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  let common = 0;
  for (const t of ta) if (setB.has(t)) common++;
  return Math.round((common / Math.min(ta.length, tb.length)) * 100) / 100;
}

function terms(t: string): string[] {
  return [...new Set(t.toLowerCase().split(/\W+/).filter((w) => w.length > 2))];
}

interface Group {
  repoId: string;
  kind: string;
  members: MemoryRecord[];
}

function groupByRepoKind(memories: MemoryRecord[]): Group[] {
  const map = new Map<string, Group>();
  for (const m of memories) {
    const key = `${m.repoId}\u0000${m.kind}`;
    let g = map.get(key);
    if (!g) {
      g = { repoId: m.repoId, kind: m.kind, members: [] };
      map.set(key, g);
    }
    g.members.push(m);
  }
  return [...map.values()];
}

/** Whitelist kinds so hostile/unknown kinds can't smuggle group keys. */
const KIND_SET = new Set<MemoryKind>(["decision", "fact", "preference"]);
function isKind(m: MemoryRecord): m is MemoryRecord & { kind: MemoryKind } {
  return KIND_SET.has(m.kind as MemoryKind);
}

/**
 * Compute a dry-run consolidation plan. The passes run SUPERSEDE → COLLAPSE →
 * CLUSTER; later passes only see entries the earlier passes left active
 * (not superseded, not collapsed). Inputs are never mutated.
 */
export function consolidate(memories: MemoryRecord[], opts: ConsolidateOptions = {}): ConsolidationPlan {
  const collapseThreshold = opts.collapseThreshold ?? 0.75;
  const clusterThreshold = opts.clusterThreshold ?? 0.5;
  const windowMs = opts.windowMs ?? 24 * 60 * 60 * 1000;
  const markers = opts.supersedeMarkers ?? ["[superseded]"];

  const filtered = memories.filter(isKind);
  const plan: ConsolidationPlan = { supersede: [], collapse: [], cluster: [] };
  const isObsolete = (m: MemoryRecord): boolean =>
    m.obsolete === true || markers.some((mk) => m.text.includes(mk));

  // ---- Pass 1: SUPERSEDE ------------------------------------------------
  // Obsolete entries keep their row but are marked superseded_by the nearest
  // NEWER entry in the same (repoId, kind). Chains emerge naturally:
  // A→B when B is the nearest newer, B→C, … An obsolete newest with no newer
  // replacement self-tombstones (superseded_by = own id) so it leaves recall.
  const superseded = new Set<string>();
  for (const g of groupByRepoKind(filtered)) {
    const group = g.members.filter(isObsolete).sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id));
    const newer = g.members.slice().sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id));
    for (const e of group) {
      let target: MemoryRecord | null = null;
      for (const n of newer) {
        if (n.id === e.id) continue;
        if (n.ts > e.ts || (n.ts === e.ts && n.id.localeCompare(e.id) > 0)) {
          target = n;
          break;
        }
      }
      const supersededBy = target ? target.id : e.id;
      superseded.add(e.id);
      plan.supersede.push({
        id: e.id,
        supersededBy,
        reason: target
          ? `obsolete; superseded by ${target.id}`
          : "obsolete; no newer replacement — self-tombstoned",
      });
    }
  }

  // ---- Pass 2: COLLAPSE -------------------------------------------------
  // Near-duplicates: same (repoId, kind), within windowMs, pairwise token
  // overlap >= collapseThreshold. A run of near-identical entries collapses
  // into the NEWEST member; the older members are marked collapsed_into it.
  const collapsedInto = new Map<string, string>(); // memberId -> mergedId
  const removedIds = new Set<string>();            // all member ids (not the merged keep)
  for (const g of groupByRepoKind(filtered)) {
    const active = g.members
      .filter((m) => !superseded.has(m.id))
      .sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id));
    let i = 0;
    while (i < active.length) {
      const start = active[i];
      const memberIds: string[] = [];
      let j = i + 1;
      while (
        j < active.length &&
        active[j].ts - start.ts <= windowMs &&
        tokenOverlap(active[j].text, start.text) >= collapseThreshold
      ) {
        memberIds.push(active[j].id);
        j++;
      }
      if (memberIds.length > 0) {
        const mergedId = active[j - 1].id; // newest of the run survives
        const older = [start.id, ...memberIds.slice(0, -1)];
        for (const old of older) {
          collapsedInto.set(old, mergedId);
          removedIds.add(old);
        }
        plan.collapse.push({ mergedId, memberIds: older });
      }
      i = j;
    }
  }

  // ---- Pass 3: CLUSTER --------------------------------------------------
  // Remaining active entries (not superseded, not collapsed) are grouped by
  // token-overlap >= clusterThreshold (transitive via a greedy representative).
  // Each multi-member group gets a synthetic centroid tag to speed recall().
  const remaining = filtered
    .filter((m) => !superseded.has(m.id) && !removedIds.has(m.id))
    .sort((x, y) => x.ts - y.ts || x.id.localeCompare(y.id));
  const clusters: ClusterEntry[] = [];
  for (const m of remaining) {
    let placed = false;
    for (const c of clusters) {
      const rep = remaining.find((r) => r.id === c.memberIds[0]);
      if (rep && tokenOverlap(m.text, rep.text) >= clusterThreshold) {
        c.memberIds.push(m.id);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ tag: `cluster-${clusters.length + 1}`, memberIds: [m.id] });
    }
  }
  for (const c of clusters) {
    if (c.memberIds.length > 1) plan.cluster.push(c);
  }

  return plan;
}

/** Convenience: the set of ids a plan marks superseded. */
export function supersededIds(plan: ConsolidationPlan): Set<string> {
  return new Set(plan.supersede.map((s) => s.id));
}

/** Convenience: the set of ids a plan collapses (members — merged ids stay active). */
export function collapsedIds(plan: ConsolidationPlan): Set<string> {
  return new Set(plan.collapse.flatMap((c) => c.memberIds));
}
