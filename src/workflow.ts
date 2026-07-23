/**
 * workflow.ts — DAG engine for ithacus team execution.
 *
 * Topological sort + wave generation for parallel-within-wave,
 * sequential-across-wave execution of a team's task graph.
 *
 * pi-agnostic: pure functions over `WorkflowNode[]`, fully unit-testable.
 */

import type {
  WorkflowNode,
  WaveExecution,
} from "./types.js";

/**
 * Detect a cycle in the dependency graph using DFS with white/grey/black
 * coloring. Returns the list of node ids forming the cycle (a path from a
 * node back to itself), or `null` if the graph is acyclic.
 *
 * @param nodes the workflow nodes to inspect
 * @returns the cycle path (last id == first id) or null when no cycle
 */
export function detectCycle(nodes: WorkflowNode[]): string[] | null {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const byId = new Map<string, WorkflowNode>();
  for (const n of nodes) {
    byId.set(n.id, n);
    color.set(n.id, WHITE);
  }
  const path: string[] = [];

  let result: string[] | null = null;

  const visit = (id: string): boolean => {
    color.set(id, GREY);
    path.push(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) {
      if (!byId.has(dep)) continue; // unknown deps handled by validateDag
      const c = color.get(dep);
      if (c === GREY) {
        // found a back-edge: slice the cycle from `dep` onward + close it.
        const start = path.indexOf(dep);
        result = [...path.slice(start), dep];
        return true;
      }
      if (c === WHITE && visit(dep)) return true;
    }
    path.pop();
    color.set(id, BLACK);
    return false;
  };

  for (const n of nodes) {
    if (color.get(n.id) === WHITE && visit(n.id)) return result;
  }
  return null;
}

/**
 * Topologically sort the nodes so every dependency precedes its dependents.
 * Stable: nodes with equal precedence keep their input order.
 *
 * @throws Error when the graph contains a cycle
 */
export function topologicalSort(nodes: WorkflowNode[]): string[] {
  const byId = new Map<string, WorkflowNode>();
  for (const n of nodes) byId.set(n.id, n);

  const cycle = detectCycle(nodes);
  if (cycle) {
    throw new Error(
      `workflow: cannot topologically sort — cycle detected: ${cycle.join(" -> ")}`,
    );
  }

  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) return; // guarded by detectCycle already
    visiting.add(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) {
      if (byId.has(dep)) visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    sorted.push(id);
  }

  for (const n of nodes) visit(n.id);
  return sorted;
}

/**
 * Group nodes into execution waves via Kahn's algorithm. Wave 0 holds every
 * node with no dependencies; wave N holds nodes whose dependencies are all in
 * waves < N. Each node appears in exactly one wave.
 *
 * @throws Error when the graph contains a cycle
 */
export function generateWaves(nodes: WorkflowNode[]): WaveExecution {
  const byId = new Map<string, WorkflowNode>();
  for (const n of nodes) byId.set(n.id, n);

  const cycle = detectCycle(nodes);
  if (cycle) {
    throw new Error(
      `workflow: cannot generate waves — cycle detected: ${cycle.join(" -> ")}`,
    );
  }

  const waves: string[][] = [];
  const placed = new Set<string>();
  const remaining = new Set(nodes.map((n) => n.id));

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      const node = byId.get(id)!;
      const depsReady = node.dependsOn.every(
        (d) => placed.has(d) || !byId.has(d),
      );
      if (depsReady) wave.push(id);
    }
    if (wave.length === 0) {
      // Should be unreachable (cycle already rejected), but guard anyway.
      throw new Error(
        `workflow: stuck — unresolved deps for: ${[...remaining].join(", ")}`,
      );
    }
    for (const id of wave) {
      remaining.delete(id);
      placed.add(id);
    }
    waves.push(wave);
  }

  return { waves, totalWaves: waves.length };
}

/**
 * Validate a workflow DAG: reject duplicate ids, references to unknown
 * dependencies, and dependency cycles. Throws a descriptive Error otherwise.
 */
export function validateDag(nodes: WorkflowNode[]): void {
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) {
      throw new Error(`workflow: duplicate node id "${n.id}"`);
    }
    ids.add(n.id);
  }
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (!ids.has(dep)) {
        throw new Error(
          `workflow: node "${n.id}" depends on unknown node "${dep}"`,
        );
      }
    }
  }
  const cycle = detectCycle(nodes);
  if (cycle) {
    throw new Error(
      `workflow: dependency cycle detected: ${cycle.join(" -> ")}`,
    );
  }
}
