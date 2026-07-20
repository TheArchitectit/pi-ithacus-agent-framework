/**
 * parallel.ts — parallel-safe tool-batch execution (PR #3250 execute_batch).
 *
 * When a response emits multiple tool calls, read-only tools run concurrently
 * (Promise.all); everything that mutates state runs sequentially in order. This
 * is the single biggest throughput win the PR delivered — keep it.
 *
 * pi-agnostic: operates on a generic ToolCall shape + an executor the extension
 * supplies (so it stays testable without the pi runtime).
 */

export type ToolName =
  | "read_file"
  | "glob_search"
  | "grep_search"
  | "WebFetch"
  | "WebSearch"
  | "LSP"
  | "GitStatus"
  | "GitDiff"
  | "GitLog"
  | "GitShow"
  | "Agent"
  | "TeamStatus"
  | "TaskGet"
  | "TaskList"
  | "write_file"
  | "GitCommit"
  | "task_claim"
  | "inbox_send"
  | (string & {});

/** Tools safe to run concurrently (PR #3250 parallel-safe classification). */
const PARALLEL_SAFE = new Set<ToolName>([
  "read_file",
  "glob_search",
  "grep_search",
  "WebFetch",
  "WebSearch",
  "LSP",
  "GitStatus",
  "GitDiff",
  "GitLog",
  "GitShow",
  "Agent",
  "TeamStatus",
  "TaskGet",
  "TaskList",
]);

export interface ToolCall {
  name: ToolName;
  args: unknown;
}

export interface ToolResult {
  name: ToolName;
  ok: boolean;
  value: unknown;
}

export function isParallelSafe(name: ToolName): boolean {
  return PARALLEL_SAFE.has(name);
}

/**
 * Execute a batch: partition into parallel-safe vs sequential, run the safe set
 * concurrently, then the sequential set in order. Returns results keyed by call.
 */
export async function executeBatch(
  calls: ToolCall[],
  run: (call: ToolCall) => Promise<ToolResult>,
): Promise<ToolResult[]> {
  const safe: ToolCall[] = [];
  const seq: ToolCall[] = [];
  for (const c of calls) (isParallelSafe(c.name) ? safe : seq).push(c);

  const safeResults = safe.length ? await Promise.all(safe.map((c) => run(c))) : [];
  const seqResults: ToolResult[] = [];
  for (const c of seq) seqResults.push(await run(c));

  // Preserve original call order in the output.
  const byNameIndex = new Map<ToolName, number[]>();
  calls.forEach((c, i) => {
    const arr = byNameIndex.get(c.name) ?? [];
    arr.push(i);
    byNameIndex.set(c.name, arr);
  });
  const out: ToolResult[] = new Array(calls.length);
  let si = 0;
  let qi = 0;
  calls.forEach((c, i) => {
    if (isParallelSafe(c.name)) out[i] = safeResults[si++];
    else out[i] = seqResults[qi++];
  });
  return out;
}
