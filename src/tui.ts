/**
 * tui.ts — terminal UI with differential rendering via an injectable renderer.
 *
 * pi-agnostic: src/ never touches raw stdout/TTY and never opens a network or
 * IPC channel (PREVENT-ITH-004). The renderer is injected (DI) so the client
 * is fully unit-testable with a mock; the extension layer wires a real pi TUI.
 */

import type { ToolCard, EditPreview, AskOption, QrCode } from './types.js';

/** Injectable TUI renderer (mirrors lsp.ts LspTransport pattern). */
export interface TuiRenderer {
  /** Render the full frame (initial paint). */
  render(frame: TuiFrame): Promise<void>;
  /** Apply a differential update (only changed regions). */
  applyDiff(diff: TuiDiff): Promise<void>;
  /** Read user input (for ask pickers). */
  readInput(prompt: string): Promise<string>;
  /** Clear the screen. */
  clear(): Promise<void>;
  /** Whether the renderer is attached to a TTY. */
  isAttached?(): boolean;
}

/** A full TUI frame (what's on screen). */
export interface TuiFrame {
  cards: ToolCard[];
  statusLine: string;
  inputLine: string;
  ts: number;
}

/** A differential update (only changed cards). */
export interface TuiDiff {
  added: ToolCard[];
  removed: string[];  // card ids
  updated: ToolCard[];
  statusLine?: string;
  inputLine?: string;
}

/** The TUI client: wraps an injected renderer with typed methods. */
export class TuiClient {
  readonly renderer: TuiRenderer;
  private cards = new Map<string, ToolCard>();
  private statusLine = '';
  private inputLine = '';
  private lastFrame: TuiFrame | null = null;

  constructor(renderer: TuiRenderer) {
    this.renderer = renderer;
  }

  /** Add a tool card. */
  addCard(card: ToolCard): void {
    this.cards.set(card.id, card);
  }

  /** Remove a tool card by id. */
  removeCard(id: string): boolean {
    return this.cards.delete(id);
  }

  /** Update a tool card (returns false if not found). */
  updateCard(card: ToolCard): boolean {
    if (!this.cards.has(card.id)) return false;
    this.cards.set(card.id, card);
    return true;
  }

  /** Set the status line. */
  setStatus(line: string): void {
    this.statusLine = line;
  }

  /** Set the input line. */
  setInput(line: string): void {
    this.inputLine = line;
  }

  /** Render the current state as a full frame. */
  async render(): Promise<TuiFrame> {
    const frame: TuiFrame = {
      cards: [...this.cards.values()],
      statusLine: this.statusLine,
      inputLine: this.inputLine,
      ts: Date.now(),
    };
    await this.renderer.render(frame);
    this.lastFrame = frame;
    return frame;
  }

  /**
   * Compute a differential update since the last render and apply it.
   * @returns the computed diff (added/removed/updated).
   */
  async renderDiff(): Promise<TuiDiff> {
    const current = [...this.cards.values()];
    const currentIds = new Set(current.map(c => c.id));
    const previous = this.lastFrame?.cards ?? [];
    const previousIds = new Map(previous.map(c => [c.id, c]));

    const added: ToolCard[] = [];
    const updated: ToolCard[] = [];
    for (const card of current) {
      const prev = previousIds.get(card.id);
      if (!prev) added.push(card);
      else if (prev.body !== card.body || prev.title !== card.title || prev.collapsed !== card.collapsed) updated.push(card);
    }
    const removed: string[] = previous.filter(c => !currentIds.has(c.id)).map(c => c.id);
    const diff: TuiDiff = {
      added, removed, updated,
      ...(this.statusLine !== this.lastFrame?.statusLine ? { statusLine: this.statusLine } : {}),
      ...(this.inputLine !== this.lastFrame?.inputLine ? { inputLine: this.inputLine } : {}),
    };
    await this.renderer.applyDiff(diff);
    this.lastFrame = { cards: current, statusLine: this.statusLine, inputLine: this.inputLine, ts: Date.now() };
    return diff;
  }

  /** Render an edit preview. */
  async renderEditPreview(preview: EditPreview): Promise<void> {
    const card: ToolCard = {
      id: `preview-${preview.filePath}`,
      title: `Edit: ${preview.filePath}`,
      body: preview.diffHunks.join('\n'),
      kind: 'tool_result',
      collapsed: false,
    };
    this.addCard(card);
    await this.renderDiff();
  }

  /** Render an ask picker; returns the selected option id. */
  async askPicker(prompt: string, options: AskOption[]): Promise<string> {
    const input = await this.renderer.readInput(`${prompt} [${options.map(o => o.label).join('/')}]`);
    const match = options.find(o => o.label.toLowerCase() === input.toLowerCase() || o.id === input);
    return match?.id ?? options[0]?.id ?? '';
  }

  /** Render a QR code (returns the QR payload). */
  async renderQr(text: string, qrGenerator: (text: string) => QrCode): Promise<void> {
    const qr = qrGenerator(text);
    const card: ToolCard = {
      id: `qr-${Date.now()}`,
      title: 'QR Code',
      body: qr.ascii,
      kind: 'info',
      collapsed: false,
    };
    this.addCard(card);
    await this.renderDiff();
  }

  /** Clear the TUI. */
  async clear(): Promise<void> {
    this.cards.clear();
    this.statusLine = '';
    this.inputLine = '';
    await this.renderer.clear();
    this.lastFrame = null;
  }

  /** Whether the renderer is attached. */
  isAttached(): boolean {
    return this.renderer.isAttached?.() ?? true;
  }
}

/** Create a TUI client over an injected renderer. */
export function createTuiClient(renderer: TuiRenderer): TuiClient {
  return new TuiClient(renderer);
}
