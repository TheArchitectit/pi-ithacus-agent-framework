/**
 * lsp.ts — Language Server Protocol client with an injectable transport.
 *
 * pi-agnostic: src/ never spawns a real LSP server and never opens a network
 * or IPC channel (PREVENT-ITH-004). The transport is injected (dependency
 * injection) so the client is fully unit-testable with a mock; the extension
 * layer wires a real JSON-RPC channel to a language server process.
 *
 * Supports the 14 LSP operations listed in LspMethod.
 */

import type {
  LspMethod, LspTextDocumentIdentifier, LspDiagnostic, LspLocation, LspRange, LspSymbol,
  LspHover, LspSignatureHelp, LspCodeAction, LspTextEdit, LspFoldingRange,
  LspSelectionRange, LspSemanticTokens, LspPosition,
} from './types.js';

/** Injectable JSON-RPC transport (mirrors search.ts FetchFn pattern). */
export interface LspTransport {
  /** Send a request and await the response. */
  request(method: string, params: unknown): Promise<unknown>;
  /** Notify (fire-and-forget). */
  notify?: (method: string, params: unknown) => void;
  /** Whether the transport is ready. */
  isReady?: () => boolean;
}

/** A document opened in the LSP workspace. */
export interface LspDocument {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

/** The LSP client: wraps an injected transport with typed methods. */
export class LspClient {
  readonly transport: LspTransport;
  private openDocs = new Map<string, LspDocument>();

  constructor(transport: LspTransport) {
    this.transport = transport;
  }

  /** Initialize the language server (returns server capabilities). */
  async initialize(rootUri: string): Promise<Record<string, unknown>> {
    const result = await this.transport.request('initialize', {
      processId: null,
      rootUri,
      capabilities: {},
    });
    this.transport.notify?.('initialized', {});
    return (result as { capabilities?: Record<string, unknown> })?.capabilities ?? {};
  }

  /** Open a document (didOpen). */
  openDocument(doc: LspDocument): void {
    this.openDocs.set(doc.uri, doc);
    this.transport.notify?.('textDocument/didOpen', {
      textDocument: { uri: doc.uri, languageId: doc.languageId, version: doc.version, text: doc.text },
    });
  }

  /** Edit an open document (didChange — full sync). */
  changeDocument(uri: string, version: number, text: string): void {
    const doc = this.openDocs.get(uri);
    if (!doc) throw new Error(`lsp: document not open: ${uri}`);
    doc.version = version;
    doc.text = text;
    this.transport.notify?.('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  /** Close a document (didClose). */
  closeDocument(uri: string): void {
    this.openDocs.delete(uri);
    this.transport.notify?.('textDocument/didClose', { textDocument: { uri } });
  }

  /** Whether a document is currently open. */
  isOpen(uri: string): boolean {
    return this.openDocs.has(uri);
  }

  // ---- The 14 LSP operations (typed request/response) ----

  /** 1. Diagnostics (pull model via request; push comes via notify). */
  async diagnostics(doc: LspTextDocumentIdentifier): Promise<LspDiagnostic[]> {
    const result = await this.transport.request('textDocument/diagnostic', { textDocument: doc });
    return ((result as { items?: unknown[] })?.items ?? []) as LspDiagnostic[];
  }

  /** 2. Go-to-definition. */
  async definition(doc: LspTextDocumentIdentifier, position: LspPosition): Promise<LspLocation[]> {
    const result = await this.transport.request('textDocument/definition', { textDocument: doc, position });
    return normalizeLocations(result);
  }

  /** 3. Find references. */
  async references(doc: LspTextDocumentIdentifier, position: LspPosition, includeDeclaration = true): Promise<LspLocation[]> {
    const result = await this.transport.request('textDocument/references', {
      textDocument: doc, position, context: { includeDeclaration },
    });
    return toArray(result) as LspLocation[];
  }

  /** 4. Rename a symbol. */
  async rename(doc: LspTextDocumentIdentifier, position: LspPosition, newName: string): Promise<LspTextEdit[]> {
    const result = await this.transport.request('textDocument/rename', { textDocument: doc, position, newName });
    return flattenWorkspaceEdit(result);
  }

  /** 5. Code actions (quick fixes, refactors). */
  async codeAction(doc: LspTextDocumentIdentifier, range: { start: LspPosition; end: LspPosition }): Promise<LspCodeAction[]> {
    const result = await this.transport.request('textDocument/codeAction', { textDocument: doc, range, context: { diagnostics: [] } });
    return (result as unknown[] ?? []) as LspCodeAction[];
  }

  /** 6. Workspace symbols. */
  async workspaceSymbols(query: string): Promise<LspSymbol[]> {
    const result = await this.transport.request('workspace/symbol', { query });
    return (result as unknown[] ?? []) as LspSymbol[];
  }

  /** 7. Document symbols. */
  async documentSymbol(doc: LspTextDocumentIdentifier): Promise<LspSymbol[]> {
    const result = await this.transport.request('textDocument/documentSymbol', { textDocument: doc });
    return (result as unknown[] ?? []) as LspSymbol[];
  }

  /** 8. Hover. */
  async hover(doc: LspTextDocumentIdentifier, position: LspPosition): Promise<LspHover | null> {
    const result = await this.transport.request('textDocument/hover', { textDocument: doc, position });
    return (result as LspHover | null) ?? null;
  }

  /** 9. Signature help. */
  async signatureHelp(doc: LspTextDocumentIdentifier, position: LspPosition): Promise<LspSignatureHelp | null> {
    const result = await this.transport.request('textDocument/signatureHelp', { textDocument: doc, position });
    return (result as LspSignatureHelp | null) ?? null;
  }

  /** 10. Formatting (whole document). */
  async formatting(doc: LspTextDocumentIdentifier, options: Record<string, unknown> = {}): Promise<LspTextEdit[]> {
    const result = await this.transport.request('textDocument/formatting', { textDocument: doc, options });
    return (result as unknown[] ?? []) as LspTextEdit[];
  }

  /** 11. Folding ranges. */
  async foldingRange(doc: LspTextDocumentIdentifier): Promise<LspFoldingRange[]> {
    const result = await this.transport.request('textDocument/foldingRange', { textDocument: doc });
    return (result as unknown[] ?? []) as LspFoldingRange[];
  }

  /** 12. Selection ranges. */
  async selectionRange(doc: LspTextDocumentIdentifier, positions: LspPosition[]): Promise<LspSelectionRange[]> {
    const result = await this.transport.request('textDocument/selectionRange', { textDocument: doc, positions });
    return (result as unknown[] ?? []) as LspSelectionRange[];
  }

  /** 13. Linked editing range (symmetric tag edits). */
  async linkedEditingRange(doc: LspTextDocumentIdentifier, position: LspPosition): Promise<{ ranges: { start: LspPosition; end: LspPosition }[]; wordPattern?: string } | null> {
    const result = await this.transport.request('textDocument/linkedEditingRange', { textDocument: doc, position });
    return (result as { ranges: { start: LspPosition; end: LspPosition }[]; wordPattern?: string } | null) ?? null;
  }

  /** 14. Semantic tokens (full). */
  async semanticTokensFull(doc: LspTextDocumentIdentifier): Promise<LspSemanticTokens> {
    const result = await this.transport.request('textDocument/semanticTokens/full', { textDocument: doc });
    return (result as LspSemanticTokens) ?? { data: [] };
  }

  /** Shutdown the server (graceful). */
  async shutdown(): Promise<void> {
    await this.transport.request('shutdown', null);
    this.transport.notify?.('exit', null);
    this.openDocs.clear();
  }
}

/** Create a fresh LSP client over an injected transport. */
export function createLspClient(transport: LspTransport): LspClient {
  return new LspClient(transport);
}

function toArray(result: unknown): unknown[] {
  if (result == null) return [];
  return Array.isArray(result) ? result : [result];
}

/**
 * Flatten an LSP WorkspaceEdit ({changes?, documentChanges?}) into a flat
 * TextEdit list. `changes` is a uri → TextEdit[] map; `documentChanges` is
 * an array of TextDocumentEdit (each with { textDocument: {uri}, edits: TextEdit[] }).
 * Returns [] if the edit is null/absent.
 */
function flattenWorkspaceEdit(result: unknown): LspTextEdit[] {
  if (!result || typeof result !== 'object') return [];
  const we = result as { changes?: Record<string, LspTextEdit[]>; documentChanges?: Array<{ edits?: LspTextEdit[] }> };
  if (we.changes) {
    return Object.values(we.changes).flat();
  }
  if (Array.isArray(we.documentChanges)) {
    return we.documentChanges.flatMap((d) => d.edits ?? []);
  }
  return [];
}

/** Normalize definition result (Location | Location[] | LocationLink[] | null) to LspLocation[]. */
function normalizeLocations(result: unknown): LspLocation[] {
  const arr = toArray(result);
  return arr.map((item): LspLocation => {
    const l = item as { uri?: string; range?: LspRange; targetUri?: string; targetRange?: LspRange };
    return {
      uri: l.uri ?? l.targetUri ?? '',
      range: l.range ?? l.targetRange ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    };
  });
}
