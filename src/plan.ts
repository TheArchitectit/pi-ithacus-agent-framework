/**
 * plan.ts — PlanSynthesizer (goal → WorkflowTemplate) + PlanRunner (queue → dispatch → persist).
 *
 * Sprint 5.6. pi-agnostic: uses injectable SwarmExecutor + SwarmStore (node:sqlite).
 * Zero network (PREVENT-ITH-004). Imports only from ./types-sprint-5.2, ./types-sprint-5.4,
 * ./swarm, ./queue, ./store-swarm, ./workflow-yaml.
 */

import type { WorkflowTemplate, WorkflowStep } from './types-sprint-5.2.js';
import type { SwarmExecutor, SwarmResult } from './types-sprint-5.4.js';
import { SwarmOrchestrator } from './swarm.js';
import { WorkQueue } from './queue.js';
import { SwarmStore } from './store-swarm.js';
import { validateTemplate } from './workflow-yaml.js';

// ── PlanSynthesizer types ──────────────────────────────────────────────

export interface PlanRequest {
  goal: string;
  agents: Array<{ role?: string }>;
}

export interface PlanMetadata {
  agentCount: number;
  goalLength: number;
  createdAt: number;
}

export interface PlanOutcome {
  storeRunId: string;
  swarmName: string;
  total: number;
  successful: number;
  failed: number;
  blocked: number;
  synthesis: PlanMetadata;
  result: SwarmResult;
}

const DEFAULT_ROLE = 'Explore';

/**
 * PlanSynthesizer — MVP synthesizer: generates a linear pipeline
 * WorkflowTemplate from a goal + agent roster. Each agent produces one
 * step; steps chain via dependsOn (linear). Fallback: single Explore step.
 */
export class PlanSynthesizer {
  private now: () => number;

  constructor(now?: () => number) {
    this.now = now ?? (() => Date.now());
  }

  synthesize(req: PlanRequest): WorkflowTemplate {
    const goal = req.goal.trim();
    const agents = req.agents.length > 0 ? req.agents : [{ role: DEFAULT_ROLE }];
    const steps: WorkflowStep[] = agents.map((agent, i) => {
      const stepId = `step-${i + 1}`;
      const prevId = i > 0 ? `step-${i}` : undefined;
      return {
        id: stepId,
        name: `${agent.role ?? DEFAULT_ROLE} — ${goal.slice(0, 40)}`,
        type: 'task' as const,
        role: agent.role ?? DEFAULT_ROLE,
        goal: i === 0 ? goal : `Continue from ${prevId}: ${goal}`,
        dependsOn: prevId ? [prevId] : undefined,
      };
    });

    return {
      name: `plan-${this.now().toString(36)}`,
      description: goal,
      steps,
      variables: { goal },
      metadata: { agentCount: agents.length, goalLength: goal.length, createdAt: this.now() },
    };
  }

  metadata(req: PlanRequest): PlanMetadata {
    return {
      agentCount: req.agents.length || 1,
      goalLength: req.goal.length,
      createdAt: this.now(),
    };
  }
}

export function createPlanSynthesizer(now?: () => number): PlanSynthesizer {
  return new PlanSynthesizer(now);
}

// ── PlanRunner ─────────────────────────────────────────────────────────

/**
 * PlanRunner — runs a plan end-to-end: synthesize → queue → dispatch → persist.
 * pi-agnostic: uses injectable SwarmExecutor + SwarmStore (node:sqlite).
 */
export class PlanRunner {
  private synthesizer: PlanSynthesizer;
  private executor: SwarmExecutor;
  private store: SwarmStore;

  constructor(
    synthesizer: PlanSynthesizer,
    executor: SwarmExecutor,
    store: SwarmStore,
  ) {
    this.synthesizer = synthesizer;
    this.executor = executor;
    this.store = store;
  }

  async execute(req: PlanRequest, opts?: {
    checkpointInterval?: number;
    maxBlockedPolls?: number;
    blockedWaitMs?: number;
    maxItems?: number;
  }): Promise<PlanOutcome> {
    // 1. synthesize template
    const template = this.synthesizer.synthesize(req);
    const err = validateTemplate(template);
    if (err) throw new Error(`plan synthesis failed: ${err}`);

    // 2. build queue from template
    const queue = new WorkQueue();
    const idMap = new Map<string, number>();
    for (const step of template.steps) {
      const depIds = (step.dependsOn ?? [])
        .map(d => idMap.get(d))
        .filter((x): x is number => typeof x === 'number');
      const itemId = queue.addItem({
        name: step.id,
        assignedRole: step.role ?? undefined,
        priority: 0,
        dependsOn: depIds,
        payload: { prompt: step.goal ?? step.name },
      });
      idMap.set(step.id, itemId);
    }

    // 3. dispatch via SwarmOrchestrator
    const orch = new SwarmOrchestrator(this.executor, queue);
    const result = await orch.dispatch({
      swarmName: template.name,
      enableCheckpoint: true,
      checkpointInterval: opts?.checkpointInterval ?? 30,
      maxBlockedPolls: opts?.maxBlockedPolls ?? 100,
      blockedWaitMs: opts?.blockedWaitMs ?? 0,
      maxItems: opts?.maxItems ?? 0,
    });

    // 4. persist to store
    const storeRunId = this.store.saveSwarmResult(result, this.executor.now());

    return {
      storeRunId,
      swarmName: template.name,
      total: result.total,
      successful: result.successful,
      failed: result.failed,
      blocked: result.blocked,
      synthesis: this.synthesizer.metadata(req),
      result,
    };
  }
}

export function createPlanRunner(
  synthesizer: PlanSynthesizer,
  executor: SwarmExecutor,
  store: SwarmStore,
): PlanRunner {
  return new PlanRunner(synthesizer, executor, store);
}
