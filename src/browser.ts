/**
 * browser.ts — browser automation client with an injectable driver.
 *
 * pi-agnostic: src/ never spawns a real browser/Puppeteer/CDP and never opens
 * a network or IPC channel (PREVENT-ITH-004). The driver is injected (DI)
 * so the client is fully unit-testable with a mock; the extension layer wires
 * a real Puppeteer/CDP session to a browser process.
 */

import type {
  BrowserTab, GotoOptions, ElementSelector, Screenshot, ElementSnapshot,
  NetworkEvent, EvalResult,
} from './types.js';

/** Injectable browser driver (mirrors lsp.ts LspTransport pattern). */
export interface BrowserDriver {
  /** Open a new tab to a URL; returns the tab handle. */
  newTab(url: string, opts?: GotoOptions): Promise<BrowserTab>;
  /** Close a tab by id. */
  closeTab(id: string): Promise<void>;
  /** List open tabs. */
  listTabs(): Promise<BrowserTab[]>;
  /** Navigate an existing tab to a URL. */
  goto(id: string, url: string, opts?: GotoOptions): Promise<BrowserTab>;
  /** Evaluate a script in a tab's page context. */
  evaluate(id: string, script: string): Promise<EvalResult>;
  /** Screenshot a tab. */
  screenshot(id: string, opts?: { fullPage?: boolean; encoding?: 'binary' | 'base64' }): Promise<Screenshot>;
  /** Click an element matching a selector. */
  click(id: string, selector: ElementSelector): Promise<boolean>;
  /** Type text into an element matching a selector. */
  type(id: string, selector: ElementSelector, text: string, opts?: { delay?: number }): Promise<boolean>;
  /** Snapshot an element (serialized). */
  snapshot(id: string, selector: ElementSelector): Promise<ElementSnapshot | null>;
  /** Enable stealth mode (returns captured network events when stopped). */
  enableStealth?(id: string): Promise<void>;
  /** Disable stealth mode and return captured events. */
  disableStealth?(id: string): Promise<NetworkEvent[]>;
  /** Whether the driver is ready/connected. */
  isReady?(): boolean;
}

/** The browser client: wraps an injected driver with typed methods. */
export class BrowserClient {
  readonly driver: BrowserDriver;

  constructor(driver: BrowserDriver) {
    this.driver = driver;
  }

  /** Open a new tab. */
  async open(url: string, opts?: GotoOptions): Promise<BrowserTab> {
    return this.driver.newTab(url, opts);
  }

  /** Close a tab. */
  async close(id: string): Promise<void> {
    return this.driver.closeTab(id);
  }

  /** List open tabs. */
  async tabs(): Promise<BrowserTab[]> {
    return this.driver.listTabs();
  }

  /** Navigate a tab. */
  async goto(id: string, url: string, opts?: GotoOptions): Promise<BrowserTab> {
    return this.driver.goto(id, url, opts);
  }

  /** Evaluate a script in a tab. */
  async evaluate(id: string, script: string): Promise<EvalResult> {
    return this.driver.evaluate(id, script);
  }

  /** Screenshot a tab. */
  async screenshot(id: string, opts?: { fullPage?: boolean; encoding?: 'binary' | 'base64' }): Promise<Screenshot> {
    return this.driver.screenshot(id, opts);
  }

  /** Click an element. */
  async click(id: string, selector: ElementSelector): Promise<boolean> {
    return this.driver.click(id, selector);
  }

  /** Type into an element. */
  async type(id: string, selector: ElementSelector, text: string, opts?: { delay?: number }): Promise<boolean> {
    return this.driver.type(id, selector, text, opts);
  }

  /** Snapshot an element. */
  async snapshot(id: string, selector: ElementSelector): Promise<ElementSnapshot | null> {
    return this.driver.snapshot(id, selector);
  }

  /** Enable stealth mode on a tab (records network events). */
  async enableStealth(id: string): Promise<void> {
    if (!this.driver.enableStealth) throw new Error('browser: stealth mode not supported by driver');
    return this.driver.enableStealth(id);
  }

  /** Disable stealth mode and return captured network events. */
  async disableStealth(id: string): Promise<NetworkEvent[]> {
    if (!this.driver.disableStealth) throw new Error('browser: stealth mode not supported by driver');
    return this.driver.disableStealth(id);
  }

  /** Whether the driver is ready. */
  isReady(): boolean {
    return this.driver.isReady?.() ?? true;
  }
}

/** Convenience: build a CSS selector. */
export function css(value: string): ElementSelector {
  return { strategy: 'css', value };
}

/** Convenience: build an XPath selector. */
export function xpath(value: string): ElementSelector {
  return { strategy: 'xpath', value };
}

/** Convenience: build a text-match selector. */
export function text(value: string): ElementSelector {
  return { strategy: 'text', value };
}

/** Create a browser client over an injected driver. */
export function createBrowserClient(driver: BrowserDriver): BrowserClient {
  return new BrowserClient(driver);
}
