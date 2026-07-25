/**
 * types-sprint-4.1.ts — Sprint 4.1 LSP types (split from types.ts to keep
 * that file under the 300-line guidance; pure declarations, no logic).
 * Re-exported by types.ts so existing './types.js' imports are unchanged.
 *
 * These mirror the Language Server Protocol JSON-RPC shapes (subset).
 * The transport is injectable so src/ stays pi-agnostic and zero-network
 * (PREVENT-ITH-004); the extension layer wires a real JSON-RPC channel.
 */

/** A position in a document (0-based line + character). */
export interface LspPosition {
  line: number;
  character: number;
}

/** A range in a document. */
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** A text document identifier. */
export interface LspTextDocumentIdentifier {
  uri: string;
}

/** A diagnostic (error/warning/info/hint). */
export interface LspDiagnostic {
  range: LspRange;
  severity: 'error' | 'warning' | 'info' | 'hint';
  code?: string | number;
  source?: string;
  message: string;
}

/** A location (URI + range) — used for definitions/references. */
export interface LspLocation {
  uri: string;
  range: LspRange;
}

/** A symbol (workspace/document). */
export interface LspSymbol {
  name: string;
  kind: number;
  range: LspRange;
  containerName?: string;
  uri?: string;
  children?: LspSymbol[];
}

/** A hover response. */
export interface LspHover {
  contents: string | { language: string; value: string };
  range?: LspRange;
}

/** A signature help response. */
export interface LspSignatureHelp {
  signatures: Array<{ label: string; documentation?: string; parameters?: Array<{ label: string; documentation?: string }> }>;
  activeSignature?: number;
  activeParameter?: number;
}

/** A completion item. */
export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

/** A code action (quick fix / refactor). */
export interface LspCodeAction {
  title: string;
  kind?: string;
  edit?: { documentChanges: unknown[] };
  command?: { title: string; command: string; arguments?: unknown[] };
}

/** A text edit. */
export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

/** A folding range. */
export interface LspFoldingRange {
  startLine: number;
  endLine: number;
  kind?: string;
}

/** A selection range. */
export interface LspSelectionRange {
  range: LspRange;
  parent?: LspSelectionRange;
}

/** Semantic tokens (absolute positions). */
export interface LspSemanticTokens {
  data: number[];
}

/** The 14 LSP operations supported by the client. */
export type LspMethod =
  | 'textDocument/diagnostic'
  | 'textDocument/definition'
  | 'textDocument/references'
  | 'textDocument/rename'
  | 'textDocument/codeAction'
  | 'workspace/symbol'
  | 'textDocument/documentSymbol'
  | 'textDocument/hover'
  | 'textDocument/signatureHelp'
  | 'textDocument/formatting'
  | 'textDocument/foldingRange'
  | 'textDocument/selectionRange'
  | 'textDocument/linkedEditingRange'
  | 'textDocument/semanticTokens/full';
