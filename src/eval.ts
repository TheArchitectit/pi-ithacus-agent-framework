/**
 * eval.ts — persistent code execution cells (Python + Bun) with an injectable
 * runtime + tool re-entry bridge.
 *
 * pi-agnostic: src/ never spawns a real Python/Bun process and never opens a
 * network/IPC channel (PREVENT-ITH-004). The runtime is injected (DI) so the
 * client is fully unit-testable with a mock; the extension layer wires a real
 * persistent cell process.
 */

import type { EvalCell, EvalCellResult } from './types.js';

/** Injectable eval runtime (mirrors lsp.ts LspTransport pattern). */
export interface EvalRuntime {
  /** Start a persistent cell (returns the cell id). */
  startCell(runtime: 'python' | 'bun', code: string): Promise<EvalCell>;
  /** Run a cell (re-evaluate; persistent cells keep state). */
  runCell(cellId: string, code?: string): Promise<EvalCellResult>;
  /** Stop a cell. */
  stopCell(cellId: string): Promise<void>;
  /** List active cells. */
  listCells(): Promise<EvalCell[]>;
  /** Call a tool (tool re-entry bridge). */
  callTool(cellId: string, tool: string, args: unknown): Promise<unknown>;
}

/** The eval client: wraps an injected runtime with typed methods. */
export class EvalClient {
  readonly runtime: EvalRuntime;
  private cells = new Map<string, EvalCell>();

  constructor(runtime: EvalRuntime) {
    this.runtime = runtime;
  }

  /** Start a persistent cell. */
  async start(runtime: 'python' | 'bun', code: string): Promise<EvalCell> {
    const cell = await this.runtime.startCell(runtime, code);
    this.cells.set(cell.id, cell);
    return cell;
  }

  /** Run a cell (re-evaluate; persistent cells keep state). */
  async run(cellId: string, code?: string): Promise<EvalCellResult> {
    if (!this.cells.has(cellId)) throw new Error(`eval: cell not found: ${cellId}`);
    return this.runtime.runCell(cellId, code);
  }

  /** Stop a cell. */
  async stop(cellId: string): Promise<void> {
    await this.runtime.stopCell(cellId);
    this.cells.delete(cellId);
  }

  /** List active cells tracked by this client. */
  list(): EvalCell[] {
    return [...this.cells.values()];
  }

  /** Call a tool from within a cell (re-entry bridge). */
  async callTool(cellId: string, tool: string, args: unknown): Promise<unknown> {
    if (!this.cells.has(cellId)) throw new Error(`eval: cell not found: ${cellId}`);
    return this.runtime.callTool(cellId, tool, args);
  }

  /** Whether a cell is tracked by this client. */
  has(cellId: string): boolean {
    return this.cells.has(cellId);
  }

  /** Stop all tracked cells. */
  async stopAll(): Promise<void> {
    const ids = [...this.cells.keys()];
    await Promise.all(ids.map(id => this.runtime.stopCell(id).catch(() => undefined)));
    this.cells.clear();
  }
}

/** Create an eval client over an injected runtime. */
export function createEvalClient(runtime: EvalRuntime): EvalClient {
  return new EvalClient(runtime);
}
