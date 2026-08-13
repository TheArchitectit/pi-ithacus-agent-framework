/**
 * mega-bridge-contract.ts — LOCAL contract mirroring pi-mega-compact's
 * `MegaBridge` (src/bridge/types.ts).
 *
 * Defined locally so tsc compiles WITHOUT pi-mega-compact installed (the
 * extension keeps `dependencies: {}` — zero runtime deps). The dynamic import
 * in mega-bridge-loader.ts is cast to this type. Kept in sync by
 * conformance/bridge-conformance.mjs — do NOT diverge field names/types.
 *
 * Type-only: no runtime code, so it is fully erased at build (no runtime dep
 * on mega-compact). Mirrors mega's `MegaBridge` field-for-field.
 */

/** Same shape as mega's EngineMessage (src/types.ts). Field-for-field: `text`,
 *  NOT `content` — the child extension builds {role, text} and compactSession
 *  reads .text. Diverging here silently breaks compaction. */
export interface BridgeMessage {
  role: "user" | "assistant" | "tool" | "custom";
  text: string;
  toolName?: string;
  /** Tool input/output payload (for tool-use / tool-result roles). */
  input?: string;
  output?: string;
}

/** Options for checkpoint recall (per-session). */
export interface BridgeRecallOptions {
  sessionId: string;
  query: string;
  limit?: number;
  recallMaxTokens?: number;
  skipInjected?: boolean;
}

/** Options for durable memory recall (stateDir-scoped, no sessionId). */
export interface BridgeMemoryRecallOptions {
  query: string;
  limit?: number;
  minSimilarity?: number;
  crossRepo?: boolean;
  crossRepoCosine?: number;
  recallMaxTokens?: number;
}

/** Input to compact a message slice into a checkpoint. */
export interface BridgeCompactInput {
  sessionId: string;
  messages: BridgeMessage[];
  keepFrom?: number;
  summary?: string;
  keyDecisions?: string[];
  nextSteps?: string[];
  filesModified?: string[];
  compressionPressure?: number;
}

/** Useful subset of CompactResult. */
export interface BridgeCompactResult {
  skipped: boolean;
  deduped: boolean;
  summary: string;
  checkpointId?: string;
  tokenEstimate: number;
  originalTokenEstimate?: number;
  compactedFrom?: number;
}

/** Mapped from RecallInjectResult. */
export interface BridgeRecallResult {
  block: string;
  report: string[];
  hitCount: number;
  empty: boolean;
}

export interface BridgeMemoryRecallResult {
  block: string;
  report: string[];
  hitCount: number;
  empty: boolean;
}

/** Options to fork a child conversation off a parent turn. */
export interface BridgeForkOptions {
  parentConversationId: string;
  turnIndex: number;
}

export interface BridgeForkSuccess {
  childConversationId: string;
  checkpointIds: string[];
  forkTurnIndex: number;
}
export interface BridgeForkError {
  error: "TURN_NOT_FOUND" | "NO_RECALL";
}
export type BridgeForkResult = BridgeForkSuccess | BridgeForkError;

/** Options for a top-k corpus / vector query. */
export interface BridgeCortexOptions {
  query: string;
  limit?: number;
  repo?: string;
}

export interface BridgeCortexResult {
  results: Array<{ checkpointId: string; score: number; summary?: string }>;
  hitCount: number;
}

/** Input to persist a durable memory. */
export interface BridgeAddMemoryInput {
  content: string;
  kind?: string;
  tags?: string[];
  category?: string;
}

/** Input to record a turn fact. */
export interface BridgeRecordTurnInput {
  conversationId: string;
  sessionId: string;
  turnIndex: number;
  role?: string;
  endedAt?: number;
  ctxTokens?: number;
  ctxPercent?: number;
  model?: string;
}

/** The bridge surface exposed to the host (mirrors mega's `MegaBridge`). */
export interface MegaBridgeContract {
  compact(input: BridgeCompactInput): BridgeCompactResult;
  recallCheckpoints(opts: BridgeRecallOptions): BridgeRecallResult;
  recallMemories(opts: BridgeMemoryRecallOptions): Promise<BridgeMemoryRecallResult>;
  recallAndInlineAsync(opts: BridgeRecallOptions): Promise<BridgeRecallResult>;
  fork(opts: BridgeForkOptions): BridgeForkResult;
  cortexQuery(opts: BridgeCortexOptions): BridgeCortexResult;
  addMemory(input: BridgeAddMemoryInput): number | void;
  recordTurn(input: BridgeRecordTurnInput): void;
  close(): void;
}
