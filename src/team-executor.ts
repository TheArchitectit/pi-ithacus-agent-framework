/**
 * team-executor.ts — Sprint 5.21 (docs/DESIGN_TEAMS_AND_SIZES.md §9/§10):
 * a PURE bounded worker-pool state machine for expanded team rosters.
 *
 * pi-agnostic: no pi imports, zero network (PREVENT-ITH-004), no timers, no
 * process control. The executor owns state transitions, dependency waves,
 * cancellation decisions, and final failure-policy evaluation. It is driven by
 * an injected, synchronous `spawn` callback (the extension adapter surfaces a
 * real per-slot `pi` subprocess there); every terminal outcome is truthful.
 *
 * This module realizes the design's "bounded parallel dispatch" semantics:
 *   - never exceeds the effective concurrency cap (active <= limit);
 *   - results render in stable roster order (independent of completion order);
 *   - role dependency waves: a slot only becomes runnable when its role
 *     dependencies have reached a terminal success state;
 *   - failure policies: continue / fail_fast / required_roles /
 *     minimum_success (design §10);
 *   - cancellation: queued slots become `cancelled`, running children are
 *     signalled via the AbortSignal; all terminal states persisted.
 *   - retry keeps the same slot id and increments an attempt counter.
 *
 * It is intentionally NOT the tool-call batching in src/parallel.ts — team
 * concurrency needs slot ids, cancellation, dependency waves, and failure
 * accounting that executeBatch() does not provide.
 */

import type {
  TeamSnapshotV1,
  SlotOutcome,
  TeamRunStatus,
  TeamFailurePolicy,
} from "./types-sprint-5.21.js";

/** A slot that is pending execution (derived from the snapshot roster). */
export interface ExecSlot {
  slotId: string;
  role: string;
  ordinal: number;
  agentType: string;
  /** roles that must reach `completed` before this slot becomes runnable. */
  dependsOnRoles: string[];
  required: boolean;
  attempt: number;
}

/** Per-slot result produced by the injected spawn callback. */
export interface SlotResult {
  slotId: string;
  success: boolean;
  summary?: string;
  error?: string;
}

/** The bounded executor's public state (read-only after construction). */
export interface TeamExecState {
  slots: ExecSlot[];
  limit: number;
  policy: TeamFailurePolicy;
  statuses: Map<string, "queued" | "running" | "completed" | "failed" | "skipped" | "cancelled">;
  active: number;
  outcomes: Map<string, SlotOutcome>;
  done: boolean;
  runStatus: TeamRunStatus;
}

/** Sink the executor uses to report terminal outcomes (truthful recording). */
export interface OutcomeSink {
  record(slotId: string, outcome: SlotOutcome): void;
}

/** Injected spawn callback. Returns immediately with a result or throws
 *  (a rejected spawn is NOT counted as completion — the slot stays failed). */
export type SlotSpawnFn = (
  slot: ExecSlot,
  signal: AbortSignal,
) => Promise<SlotResult> | SlotResult;

/**
 * Build the ExecSlot list from a validated team snapshot. `dependsOnRoles`
 * comes from the preset roles; `required` from the role spec. Stable roster
 * order is preserved (role order, then ordinal).
 */
export function execSlotsFromSnapshot(
  snapshot: TeamSnapshotV1,
  requiredRoles: string[],
  dependsOnByRole: Record<string, string[]>,
): ExecSlot[] {
  return snapshot.slots.map((s, i) => ({
    slotId: s.slotId,
    role: s.role,
    ordinal: s.ordinal,
    agentType: s.agentType,
    dependsOnRoles: dependsOnByRole[s.role] ?? [],
    required: requiredRoles.includes(s.role),
    attempt: 1,
  }));
}

/**
 * The pure bounded team executor. Drives a fixed roster through runnable
 * waves up to `limit` concurrent children. `spawn` is injected; `now` an
 * injected clock (testability). This class keeps NO async resources itself —
 * the caller awaits each `step()` and passes real child results in.
 */
export class TeamExecutor {
  readonly snapshot: TeamSnapshotV1;
  private execSlots: ExecSlot[];
  private statuses = new Map<string, "queued" | "running" | "completed" | "failed" | "skipped" | "cancelled">();
  private outcomes = new Map<string, SlotOutcome>();
  private active = 0;
  done = false;
  runStatus: TeamRunStatus = "completed";
  private policy: TeamFailurePolicy;
  private limit: number;
  private requiredRoles: string[];
  private dependsOnByRole: Record<string, string[]>;
  private sink: OutcomeSink;
  private aborted = false;

  constructor(opts: {
    snapshot: TeamSnapshotV1;
    requiredRoles: string[];
    dependsOnByRole: Record<string, string[]>;
    sink?: OutcomeSink;
  }) {
    this.snapshot = opts.snapshot;
    this.requiredRoles = [...opts.requiredRoles];
    this.dependsOnByRole = { ...opts.dependsOnByRole };
    this.policy = opts.snapshot.failurePolicy ?? { kind: "continue" };
    this.limit = opts.snapshot.effectiveConcurrency;
    this.sink = opts.sink ?? { record: () => {} };
    this.execSlots = execSlotsFromSnapshot(opts.snapshot, this.requiredRoles, this.dependsOnByRole);
    for (const s of this.execSlots) this.statuses.set(s.slotId, "queued");
  }

  /** The ordered slot list (stable roster order). */
  get slots(): ExecSlot[] {
    return this.execSlots;
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return [...this.statuses.values()].filter((s) => s === "queued").length;
  }

  /** Read a slot's current status. */
  statusOf(slotId: string): string | undefined {
    return this.statuses.get(slotId);
  }

  /** All terminal outcomes, in stable slot order. */
  outcomesInOrder(): SlotOutcome[] {
    return this.execSlots
      .map((s) => this.outcomes.get(s.slotId))
      .filter((o): o is SlotOutcome => o !== undefined);
  }

  /**
   * The slots that are runnable right now and below the concurrency cap.
   * A slot is runnable when: not terminal, not currently running, all its
   * role dependencies have reached `completed`, and we have capacity.
   * Deterministic — returns in stable roster order.
   */
  runnable(signal: AbortSignal): ExecSlot[] {
    if (this.done || this.aborted || signal.aborted) return [];
    const capacity = this.limit - this.active;
    if (capacity <= 0) return [];
    const out: ExecSlot[] = [];
    for (const s of this.execSlots) {
      if (out.length >= capacity) break;
      const st = this.statuses.get(s.slotId);
      if (st === "running" || st === "completed" || st === "failed" || st === "skipped" || st === "cancelled") continue;
      if (this.dependenciesMet(s)) {
        out.push(s);
      }
    }
    return out;
  }

  private dependenciesMet(s: ExecSlot): boolean {
    for (const dep of s.dependsOnRoles) {
      // A dependency is met when every slot of that role is `completed`.
      const depSlots = this.execSlots
        .filter((x) => x.role === dep)
        .map((x) => this.statuses.get(x.slotId));
      if (depSlots.length === 0) continue; // empty dep role trivially met
      if (!depSlots.every((st) => st === "completed")) return false;
    }
    return true;
  }

  /**
   * Mark a slot as started (called by the driver immediately before spawn).
   * Enforces the concurrency cap: returns false if the slot isn't runnable
   * or capacity is exhausted (the caller must not spawn it).
   */
  start(slotId: string, signal: AbortSignal): boolean {
    if (this.done || this.aborted || signal.aborted) return false;
    const st = this.statuses.get(slotId);
    if (st !== "queued") return false;
    if (this.active >= this.limit) return false;
    const slot = this.execSlots.find((s) => s.slotId === slotId);
    if (!slot || !this.dependenciesMet(slot)) return false;
    this.statuses.set(slotId, "running");
    this.active++;
    return true;
  }

  /**
   * Record a terminal slot outcome (truthful — never a stub). Advances the
   * machine: applies the failure policy, may queue cancellations, and finally
   * evaluates the run status. Returns the slot's persistent outcome.
   */
  complete(slotId: string, success: boolean, extra?: { summary?: string; error?: string }): SlotOutcome {
    const slot = this.execSlots.find((s) => s.slotId === slotId);
    if (!slot) {
      throw new Error(`complete() unknown slot ${slotId}`);
    }
    const st = this.statuses.get(slotId);
    if (st === "completed" || st === "failed" || st === "skipped" || st === "cancelled") {
      return this.outcomes.get(slotId)!; // idempotent
    }
    const status: "completed" | "failed" = success ? "completed" : "failed";
    const outcome: SlotOutcome = {
      slotId,
      status,
      attempt: slot.attempt,
      ...(extra?.summary ? { resultSummary: extra.summary } : {}),
      ...(extra?.error ? { error: extra.error } : {}),
    };
    this.statuses.set(slotId, status);
    this.outcomes.set(slotId, outcome);
    this.sink.record(slotId, outcome);
    if (status === "completed") {
      this.active = Math.max(0, this.active - 1);
    } else {
      this.active = Math.max(0, this.active - 1);
      this.applyFailurePolicy(slot.required ?? false);
    }
    this.evaluate();
    return outcome;
  }

  /** Handle a slot whose spawn rejected (a failed spawn is NOT completion). */
  failSpawn(slotId: string, error: string): SlotOutcome {
    const slot = this.execSlots.find((s) => s.slotId === slotId);
    if (!slot) throw new Error(`failSpawn unknown slot ${slotId}`);
    this.statuses.set(slotId, "failed");
    const outcome: SlotOutcome = { slotId, status: "failed", attempt: slot.attempt, error };
    this.outcomes.set(slotId, outcome);
    this.sink.record(slotId, outcome);
    this.active = Math.max(0, this.active - 1);
    this.applyFailurePolicy(slot.required ?? false);
    this.evaluate();
    return outcome;
  }

  /**
   * Retry a failed slot: same slot id, attempt incremented, status back to
   * `queued`. Does NOT alter size or quorum (§10); the snapshot roster is
   * unchanged.
   */
  retry(slotId: string): boolean {
    const slot = this.execSlots.find((s) => s.slotId === slotId);
    if (!slot || this.statuses.get(slotId) !== "failed") return false;
    slot.attempt++;
    this.statuses.set(slotId, "queued");
    this.outcomes.delete(slotId);
    return true;
  }

  /** Cancel queued slots (and optionally the signal's running children). */
  cancelQueued(): void {
    for (const s of this.execSlots) {
      if (this.statuses.get(s.slotId) === "queued") {
        this.statuses.set(s.slotId, "cancelled");
        const outcome: SlotOutcome = { slotId: s.slotId, status: "cancelled", attempt: s.attempt };
        this.outcomes.set(s.slotId, outcome);
        this.sink.record(s.slotId, outcome);
      }
    }
    if (this.policy.kind === "fail_fast" && this.policy.cancelRunning) {
      this.cancelRunning();
    }
  }

  /** Mark running slots cancelled (used for abort / fail_fast cancelRunning). */
  cancelRunning(): void {
    for (const s of this.execSlots) {
      if (this.statuses.get(s.slotId) === "running") {
        this.statuses.set(s.slotId, "cancelled");
        const outcome: SlotOutcome = { slotId: s.slotId, status: "cancelled", attempt: s.attempt };
        this.outcomes.set(s.slotId, outcome);
        this.sink.record(s.slotId, outcome);
        this.active = Math.max(0, this.active - 1);
      }
    }
  }

  /** A child aborted via its AbortSignal → terminal cancelled. */
  abortSlot(slotId: string): void {
    const slot = this.execSlots.find((s) => s.slotId === slotId);
    if (!slot || this.statuses.get(slotId) !== "running") return;
    this.statuses.set(slotId, "cancelled");
    const outcome: SlotOutcome = { slotId, status: "cancelled", attempt: slot.attempt };
    this.outcomes.set(slotId, outcome);
    this.sink.record(slotId, outcome);
    this.active = Math.max(0, this.active - 1);
    this.evaluate();
  }

  /** External cancellation: mark done + cancel everything (queued + running). */
  cancelAll(): void {
    this.aborted = true;
    this.cancelQueued();
    this.cancelRunning();
    this.evaluate();
  }

  private applyFailurePolicy(failedSlotRequired: boolean): void {
    // fail_fast (design §10) stops admitting queued slots after the first
    // REQUIRED failure (and optionally aborts running slots). Non-required
    // failures never trigger fail_fast. required_roles / minimum_success are
    // evaluated only at the final evaluate().
    if (this.policy.kind === "fail_fast" && failedSlotRequired && this.failedCount() > 0) {
      this.cancelQueued();
      if (this.policy.cancelRunning) this.cancelRunning();
    }
  }

  private failedCount(): number {
    return [...this.statuses.values()].filter((s) => s === "failed").length;
  }

  private completedCount(): number {
    return [...this.statuses.values()].filter((s) => s === "completed").length;
  }

  /** True when every slot has reached a terminal state. */
  private allTerminal(): boolean {
    return this.execSlots.every((s) => {
      const st = this.statuses.get(s.slotId);
      return st === "completed" || st === "failed" || st === "skipped" || st === "cancelled";
    });
  }

  /** Final run-status evaluation (design §10). */
  private evaluate(): void {
    if (!this.allTerminal()) return;
    this.done = true;
    const failed = this.failedCount();
    const completed = this.completedCount();

    // "cancelled" is reserved for user/system cancellation (design §10) — a
    // fail_fast / required / minimum_success cleanup that cancels sibling
    // slots is an internal trip, NOT an external abort, so it still reports
    // the policy verdict (failed/partial).
    if (this.aborted) {
      this.runStatus = "cancelled";
      return;
    }
    const policy = this.policy;
    let status: TeamRunStatus;
    if (failed === 0) {
      status = completed === this.execSlots.length ? "completed" : "partial";
    } else {
      switch (policy.kind) {
        case "fail_fast":
          status = "failed";
          break;
        case "required_roles": {
          const requiredFailed = this.execSlots.some(
            (s) => s.required && this.statuses.get(s.slotId) === "failed",
          );
          status = requiredFailed ? "failed" : "partial";
          break;
        }
        case "minimum_success":
          status = completed >= policy.count ? "partial" : "failed";
          break;
        case "continue":
        default: {
          // continue: success requires ALL non-optional slots (§10).
          const nonOptionalFailed = this.execSlots.some(
            (s) => !s.required && this.statuses.get(s.slotId) === "failed",
          ) || this.execSlots.some((s) => s.required && this.statuses.get(s.slotId) === "failed");
          const anySkipped = this.execSlots.some((s) => this.statuses.get(s.slotId) === "skipped");
          status = nonOptionalFailed || anySkipped ? "partial" : "completed";
          break;
        }
      }
    }
    this.runStatus = status;
  }

  /** Mark dependency-blocked slots as terminal `skipped` (§10: dependency-
   *  blocked slots are `skipped`, not successful; never counted as done). */
  markDependencyBlockedSkipped(): void {
    for (const s of this.execSlots) {
      if (this.statuses.get(s.slotId) !== "queued") continue;
      // A slot whose any dependency role never completed is skipped.
      if (!this.dependenciesMet(s)) {
        this.statuses.set(s.slotId, "skipped");
        const outcome: SlotOutcome = { slotId: s.slotId, status: "skipped", attempt: s.attempt };
        this.outcomes.set(s.slotId, outcome);
        this.sink.record(s.slotId, outcome);
      }
    }
    this.evaluate();
  }
}
