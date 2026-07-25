/**
 * types-sprint-4.2.ts — Sprint 4.2 browser + eval types (split from types.ts
 * to keep it under the 300-line guidance; pure declarations, no logic).
 * Re-exported by types.ts so existing './types.js' imports are unchanged.
 */

/** A browser tab/page handle. */
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  /** whether the tab is active/focused. */
  active: boolean;
  createdAt: number;
}

/** Navigation options for goto. */
export interface GotoOptions {
  /** wait until: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'. */
  waitUntil?: string;
  /** timeout in ms. */
  timeout?: number;
  /** referer URL. */
  referer?: string;
}

/** An element selector (CSS or XPath). */
export interface ElementSelector {
  /** 'css' | 'xpath' | 'text'. */
  strategy: 'css' | 'xpath' | 'text';
  value: string;
}

/** A screenshot capture. */
export interface Screenshot {
  /** PNG bytes (or base64 string when encoding='base64'). */
  data: string;
  encoding: 'binary' | 'base64';
  width: number;
  height: number;
  ts: number;
}

/** A DOM element snapshot (serialized). */
export interface ElementSnapshot {
  tagName: string;
  text: string;
  html: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

/** A network interaction recorded by stealth mode. */
export interface NetworkEvent {
  method: string;
  url: string;
  status: number;
  resourceType: string;
  ts: number;
}

/** Result of an evaluated script in a page context. */
export interface EvalResult {
  ok: boolean;
  /** serialized return value (or error message when !ok). */
  value: unknown;
  /** error message if the eval threw. */
  error?: string;
  ts: number;
}

/** A persistent eval cell (Python or Bun). */
export interface EvalCell {
  id: string;
  /** 'python' | 'bun'. */
  runtime: 'python' | 'bun';
  /** source code. */
  code: string;
  /** whether the cell persists state across re-evaluations. */
  persistent: boolean;
  createdAt: number;
}

/** Result of running an eval cell. */
export interface EvalCellResult {
  cellId: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** serialized return value (when the runtime supports re-entry). */
  returnValue: unknown;
  durationMs: number;
  ts: number;
}
