/**
 * dap.ts — Debug Adapter Protocol client with an injectable transport.
 *
 * pi-agnostic: src/ never spawns a real debug adapter and never opens a
 * network/IPC channel (PREVENT-ITH-004). The transport is injected (DI) so
 * the client is fully unit-testable with a mock; the extension layer wires a
 * real DAP session to a debug adapter process.
 *
 * Supports the 28 DAP operations listed in the methods below.
 */

import type {
  DapBreakpoint, DapStackFrame, DapVariable, DapScope, DapThread,
  DapStoppedEvent,
} from './types-sprint-4.4.js';

/** Injectable DAP transport (mirrors lsp.ts LspTransport pattern). */
export interface DapTransport {
  request(command: string, args: unknown): Promise<unknown>;
  /** Subscribe to events (stopped, continued, terminated, output, breakpoint). */
  on?(event: string, handler: (body: unknown) => void): () => void;
  isReady?(): boolean;
}

/** The DAP client: wraps an injected transport with typed methods. */
export class DapClient {
  readonly transport: DapTransport;

  constructor(transport: DapTransport) {
    this.transport = transport;
  }

  // ---- Lifecycle (4 ops) ----

  /** 1. Initialize the debug adapter. */
  async initialize(adapterID: string): Promise<{ supportsConfigurationDoneRequest?: boolean; supportsEvaluateForHovers?: boolean }> {
    const r = await this.transport.request('initialize', { adapterID, linesStartAt1: true, columnsStartAt1: true });
    return r as { supportsConfigurationDoneRequest?: boolean; supportsEvaluateForHovers?: boolean };
  }

  /** 2. Launch a debug session. */
  async launch(program: string, args: string[] = [], opts: Record<string, unknown> = {}): Promise<void> {
    await this.transport.request('launch', { program, args, ...opts });
  }

  /** 3. Attach to a running process. */
  async attach(program: string, opts: Record<string, unknown> = {}): Promise<void> {
    await this.transport.request('attach', { program, ...opts });
  }

  /** 4. Disconnect (terminate). */
  async disconnect(terminateDebuggee = true): Promise<void> {
    await this.transport.request('disconnect', { terminateDebuggee });
  }

  // ---- Configuration (2 ops) ----

  /** 5. Set exception breakpoints. */
  async setExceptionBreakpoints(filters: string[]): Promise<void> {
    await this.transport.request('setExceptionBreakpoints', { filters });
  }

  /** 6. Set breakpoints (returns verified breakpoints). */
  async setBreakpoints(source: string, breakpoints: Array<{ line: number; column?: number; condition?: string; logMessage?: string; hitCondition?: string }>): Promise<DapBreakpoint[]> {
    const r = await this.transport.request('setBreakpoints', { source: { path: source }, breakpoints });
    return ((r as { breakpoints?: DapBreakpoint[] })?.breakpoints ?? []) as DapBreakpoint[];
  }

  // ---- Execution control (8 ops) ----

  /** 7. configurationDone (signal config complete). */
  async configurationDone(): Promise<void> {
    await this.transport.request('configurationDone', {});
  }

  /** 8. Continue execution on a thread. */
  async continue(threadId: number): Promise<void> {
    await this.transport.request('continue', { threadId });
  }

  /** 9. Pause (suspend) a thread. */
  async pause(threadId: number): Promise<void> {
    await this.transport.request('pause', { threadId });
  }

  /** 10. Step over. */
  async next(threadId: number): Promise<void> {
    await this.transport.request('next', { threadId });
  }

  /** 11. Step into. */
  async stepIn(threadId: number): Promise<void> {
    await this.transport.request('stepIn', { threadId });
  }

  /** 12. Step out. */
  async stepOut(threadId: number): Promise<void> {
    await this.transport.request('stepOut', { threadId });
  }

  /** 13. Step back (reverse debugging). */
  async stepBack(threadId: number): Promise<void> {
    await this.transport.request('stepBack', { threadId });
  }

  /** 14. Restart frame. */
  async restartFrame(frameId: number): Promise<void> {
    await this.transport.request('restartFrame', { frameId });
  }

  // ---- Thread + stack (4 ops) ----

  /** 15. List threads. */
  async threads(): Promise<DapThread[]> {
    const r = await this.transport.request('threads', {});
    return ((r as { threads?: DapThread[] })?.threads ?? []) as DapThread[];
  }

  /** 16. Get stack trace for a thread. */
  async stackTrace(threadId: number, levels = 0): Promise<DapStackFrame[]> {
    const r = await this.transport.request('stackTrace', { threadId, levels: levels || undefined });
    return ((r as { stackFrames?: DapStackFrame[] })?.stackFrames ?? []) as DapStackFrame[];
  }

  /** 17. Get scopes for a frame. */
  async scopes(frameId: number): Promise<DapScope[]> {
    const r = await this.transport.request('scopes', { frameId });
    return ((r as { scopes?: DapScope[] })?.scopes ?? []) as DapScope[];
  }

  /** 18. Get variables for a reference (scope or structured variable). */
  async variables(variablesReference: number): Promise<DapVariable[]> {
    const r = await this.transport.request('variables', { variablesReference });
    return ((r as { variables?: DapVariable[] })?.variables ?? []) as DapVariable[];
  }

  // ---- Evaluation + data (6 ops) ----

  /** 19. Evaluate an expression. */
  async evaluate(expression: string, frameId?: number, context: 'watch' | 'repl' | 'hover' = 'repl'): Promise<DapVariable> {
    const r = await this.transport.request('evaluate', { expression, frameId, context });
    return r as DapVariable;
  }

  /** 20. Set a variable's value. */
  async setVariable(name: string, value: string, variablesReference: number): Promise<DapVariable> {
    const r = await this.transport.request('setVariable', { name, value, variablesReference });
    return r as DapVariable;
  }

  /** 21. Get source contents (lines). */
  async source(source: string, lineStart = 1, lineEnd = 100): Promise<string[]> {
    const r = await this.transport.request('source', { source: { path: source }, lineStart, lineEnd });
    return ((r as { content?: string })?.content ?? '').split('\n');
  }

  /** 22. Get loaded sources. */
  async loadedSources(): Promise<Array<{ name: string; path: string }>> {
    const r = await this.transport.request('loadedSources', {});
    return ((r as { sources?: Array<{ name: string; path: string }> })?.sources ?? []) as Array<{ name: string; path: string }>;
  }

  /** 23. Get modules. */
  async modules(): Promise<Array<{ id: number | string; name: string }>> {
    const r = await this.transport.request('modules', {});
    return ((r as { modules?: Array<{ id: number | string; name: string }> })?.modules ?? []) as Array<{ id: number | string; name: string }>;
  }

  // ---- Advanced (4 ops) ----

  /** 24. Completions (autocomplete for REPL). */
  async completions(text: string, column: number, frameId?: number): Promise<Array<{ label: string; type?: string }>> {
    const r = await this.transport.request('completions', { text, column, frameId });
    return ((r as { targets?: Array<{ label: string; type?: string }> })?.targets ?? []) as Array<{ label: string; type?: string }>;
  }

  /** 25. Goto (non-stop jump to a target). */
  async goto(threadId: number, targetId: number): Promise<void> {
    await this.transport.request('goto', { threadId, targetId });
  }

  /** 26. Restart the session. */
  async restart(): Promise<void> {
    await this.transport.request('restart', {});
  }

  /** 27. Terminate the debuggee. */
  async terminate(): Promise<void> {
    await this.transport.request('terminate', {});
  }

  /** 28. Set function breakpoints. */
  async setFunctionBreakpoints(breakpoints: Array<{ name: string; condition?: string; hitCondition?: string }>): Promise<DapBreakpoint[]> {
    const r = await this.transport.request('setFunctionBreakpoints', { breakpoints });
    return ((r as { breakpoints?: DapBreakpoint[] })?.breakpoints ?? []) as DapBreakpoint[];
  }

  // ---- Event subscription ----

  /** Subscribe to 'stopped' events. */
  onStopped(handler: (e: DapStoppedEvent) => void): () => void {
    return this.transport.on?.('stopped', (body) => handler(body as DapStoppedEvent)) ?? (() => {});
  }

  /** Subscribe to 'terminated' events. */
  onTerminated(handler: () => void): () => void {
    return this.transport.on?.('terminated', () => handler()) ?? (() => {});
  }

  /** Subscribe to 'output' events. */
  onOutput(handler: (body: { category: string; output: string }) => void): () => void {
    return this.transport.on?.('output', (body) => handler(body as { category: string; output: string })) ?? (() => {});
  }

  /** Whether the transport is ready. */
  isReady(): boolean {
    return this.transport.isReady?.() ?? true;
  }
}

/** Create a DAP client over an injected transport. */
export function createDapClient(transport: DapTransport): DapClient {
  return new DapClient(transport);
}
