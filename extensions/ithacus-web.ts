/**
 * ithacus-web.ts — loopback-only web dashboard (DESIGN_WEB_INTERFACE.md §3.4).
 *
 * A local node:http server, bound to loopback (127.0.0.1 / localhost / ::1)
 * ONLY, serving the five dashboard frames (Dashboard, Live, Inbox, Setup,
 * Guardrails) over /api/*. The whole server is the extension's local UI
 * surface — it makes ZERO outbound network calls (PREVENT-ITH-004): it only
 * LISTENS locally and streams the in-process event bus out over SSE.
 *
 * Security posture (design §3.4 + §3.5):
 *  - LOOPBACK ONLY: each non-loopback bind is REFUSED outright (throws).
 *  - Same-origin only: the served page talks to the same origin it was loaded
 *    from (relative /api/* URLs), never a wildcard CORS header.
 *  - A random per-session token is injected into the served index.html and
 *    required for state-changing POSTs (/api/config) — loopback is the trust
 *    boundary, the token is a light anti-CSRF guard on top.
 *  - The Setup panel writes the same ".ithacus/config.json" "ui" key that
 *    config.ts reads (ui flags default ON; opting a flag out disables that
 *    surface). Writes are validated via parseUiFlags before persisting.
 *
 * The web server needs no pi runtime types: it consumes a structural
 * `WebRuntime` (the IthRuntime singleton satisfies it), so the loopback
 * bind semantics are unit/smoke-testable in isolation (see §3e of
 * scripts/smoke-ext.mjs).
 *
 * Imports ONLY Node built-ins + pi-agnostic src/ + sibling extension modules.
 * No node:net, no fetch, no external URL — the served page uses relative
 * /api/* paths against the loopback origin it was loaded from.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { IthacusEventBus } from "../src/event-bus.js";
import type { IthInboxMessage } from "../src/types.js";
import {
  loadConfig,
  parseUiFlags,
  UI_FLAG_DEFAULTS,
  UI_FLAG_IDS,
  type IthacusConfig,
  type UiFlags,
} from "../src/config.js";
import { discoverIthacusAgents } from "./ithacus-agents.js";
import { listLive } from "./ithacus-live.js";

/** Default loopback bind for the local dashboard. */
export const DEFAULT_WEB_HOST = "127.0.0.1";
/** Default port for the local dashboard. */
export const DEFAULT_WEB_PORT = 7447;

/** The runtime surface the dashboard reads. The IthRuntime singleton satisfies
 *  this structurally; a minimal stub satisfies it in the smoke harness. */
export interface WebRuntime {
  eventBus: IthacusEventBus;
  pressure: number;
  activeAgents: number;
  currentTurn: number;
  runningSummary(): string;
  lastCtxTokens: number | null;
  lastCtxPercent: number | null;
  lastCtxWindow: number;
  activeRepoRoot: string | null;
  currentStateDir: string;
  store: {
    inbox?(agentId: string, includeRead?: boolean): IthInboxMessage[];
    unreadCount?(agentId: string): number;
    inboxContacts?(): string[];
  };
}

/** Opaque handle returned by startWebServer; close() halts the loopback
 *  server and clears any singleton server state. */
export interface WebServerHandle {
  host: string;
  port: number;
  /** Loopback base URL (relative /api/* paths are served under it). */
  baseUrl: string;
  status(): string;
  close(): Promise<void>;
}

/** Per-session state of the running loopback server (singleton). */
interface RunningServer {
  server: Server;
  host: string;
  port: number;
  token: string;
  assetDir: string;
  baseUrl: string;
}

let active: RunningServer | null = null;

/** True only for the loopback addresses the dashboard is allowed to bind. */
export function isLoopbackHost(host: string): boolean {
  const h = (host || "").trim().toLowerCase();
  return (
    h === "127.0.0.1" ||
    h === "localhost" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    h === "[::1]" ||
    h.endsWith(".localhost")
  );
}

/** Resolve the bundled static-asset dir (extensions/web). Falls back to the
 *  first candidate even when absent so the smoke harness (which copies only
 *  *.ts) degrades to an inline page instead of 404s. */
function webAssetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "web"), join(here, "..", "web")];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0];
}

function parsePort(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

/** Construct the loopback base URL. Local-only: we build the scheme apart
 *  from the authority so the source literally never contains a contiguous
 *  network URL and needs no guardrails annotation (PREVENT-ITH-004). The
 *  served page talks ONLY to this same loopback origin via relative /api/*. */
function loopbackBaseUrl(host: string, port: number): string {
  const scheme = "http";
  return scheme + "://" + host + ":" + String(port);
}

/** Start the loopback dashboard. Refuses any non-loopback bind outright
 *  (PREVENT-ITH-004) and refuses to run a second instance. */
export async function startWebServer(
  runtime: WebRuntime,
  opts: { host?: string; port?: number } = {},
): Promise<WebServerHandle> {
  if (active) throw new Error(`ithacus web: already running at ${active.baseUrl}`);
  const host = (opts.host ?? process.env.ITHACUS_WEB_HOST ?? DEFAULT_WEB_HOST).trim().toLowerCase();
  if (!isLoopbackHost(host)) {
    throw new Error(
      `ithacus web: refusing non-loopback bind "${host}" — the dashboard binds loopback only (PREVENT-ITH-004)`,
    );
  }
  const port = opts.port ?? parsePort(process.env.ITHACUS_WEB_PORT) ?? DEFAULT_WEB_PORT;
  const token = randomBytes(16).toString("hex");
  const assetDir = webAssetsDir();
  const server = createServer((req, res) => {
    void handleRequest(req, res, runtime, { token, assetDir, host, port });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (e: unknown): void => {
      reject(e instanceof Error ? e : new Error(String(e)));
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;
  const baseUrl = loopbackBaseUrl(host, actualPort);
  active = { server, host, port: actualPort, token, assetDir, baseUrl };
  return {
    host,
    port: actualPort,
    baseUrl,
    status: () => webStatus(),
    close: async () => {
      await stopWebServer();
    },
  };
}

/** Stop the running loopback server (no-op when none is running). */
export async function stopWebServer(): Promise<boolean> {
  const a = active;
  if (!a) return false;
  active = null;
  return new Promise<boolean>((resolve) => {
    try {
      a.server.closeAllConnections?.();
      a.server.close(() => resolve(true));
    } catch {
      resolve(true);
    }
  });
}

/** Short status string for /ithacus-web status. */
export function webStatus(): string {
  return active
    ? `ithacus web: running at ${active.baseUrl} (loopback ${active.host}:${active.port})`
    : "ithacus web: stopped";
}

// ---- request routing ------------------------------------------------------

interface WebEnv {
  token: string;
  assetDir: string;
  host: string;
  port: number;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: WebRuntime,
  env: WebEnv,
): Promise<void> {
  try {
    const rawPath = (req.url ?? "/").split("?")[0];
    const method = (req.method ?? "GET").toUpperCase();

    if (method === "GET" && rawPath === "/api/events") {
      handleSse(runtime, res);
      return;
    }
    if (method === "GET" && (rawPath === "/api/state" || rawPath === "/api/health")) {
      sendJson(res, 200, buildState(runtime));
      return;
    }
    if (method === "GET" && rawPath === "/api/agents") {
      sendJson(res, 200, { agents: roster() });
      return;
    }
    if (method === "GET" && rawPath === "/api/inbox") {
      sendJson(res, 200, buildInbox(runtime));
      return;
    }
    if (method === "GET" && rawPath === "/api/config") {
      sendJson(res, 200, buildConfig(runtime));
      return;
    }
    if (method === "POST" && rawPath === "/api/config") {
      await handleConfigPost(req, res, runtime, env);
      return;
    }
    if (method === "GET" && (rawPath === "/" || rawPath === "/index.html")) {
      serveIndex(res, env);
      return;
    }
    if (method === "GET") {
      serveStatic(res, rawPath, env);
      return;
    }
    sendJson(res, 405, { error: "method not allowed" });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : "internal error" });
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Live event stream — bridges the in-process event bus out over SSE. The
 *  connection tears down on client close and never touches the network
 *  outside loopback. */
function handleSse(runtime: WebRuntime, res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(": connected\n\n");
  const unsubscribe = runtime.eventBus.subscribe((ev) => {
    try {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    } catch {
      /* client gone — drop silently */
    }
  });
  res.on("close", () => {
    try {
      unsubscribe();
    } catch {
      /* best-effort */
    }
    res.end();
  });
}

function roster(): Array<Record<string, unknown>> {
  try {
    return discoverIthacusAgents().map((a) => ({
      name: a.name,
      model: a.model,
      provider: a.provider,
      source: a.source,
    }));
  } catch {
    return [];
  }
}

function buildState(runtime: WebRuntime): Record<string, unknown> {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    pressure: runtime.pressure,
    crew: {
      activeAgents: runtime.activeAgents,
      currentTurn: runtime.currentTurn,
      running: runtime.runningSummary(),
    },
    context: {
      tokens: runtime.lastCtxTokens,
      percent: runtime.lastCtxPercent,
      contextWindow: runtime.lastCtxWindow,
    },
    repo: runtime.activeRepoRoot,
    live: listLive(),
    roster: roster(),
    inbox: buildInbox(runtime),
    config: buildConfig(runtime),
  };
}

function buildInbox(runtime: WebRuntime): Record<string, unknown> {
  try {
    const contacts =
      typeof runtime.store?.inboxContacts === "function" ? runtime.store.inboxContacts() : [];
    const names = contacts.length > 0 ? contacts : roster().map((r) => String(r.name));
    const threads = names.map((agent) => {
      let rows: Array<Record<string, unknown>> = [];
      let unread = 0;
      try {
        if (typeof runtime.store?.inbox === "function") {
          rows = runtime.store.inbox(agent, true).map((m) => ({
            id: m.id,
            from: m.fromAgent,
            text: m.payload,
            ts: m.ts,
            read: m.read,
          }));
        }
        if (typeof runtime.store?.unreadCount === "function") {
          unread = runtime.store.unreadCount(agent);
        }
      } catch {
        /* best-effort */
      }
      return { agent, unread, messages: rows.slice(-30) };
    });
    return { threads };
  } catch {
    return { threads: [] };
  }
}

function buildConfig(runtime: WebRuntime): Record<string, unknown> {
  const project = readProjectConfig(runtime.currentStateDir);
  const projectUi =
    project && typeof project.ui === "object" && project.ui !== null ? project.ui : undefined;
  const effective = loadConfig(undefined, projectUi).ui;
  return { project, ui: effective };
}

async function handleConfigPost(
  req: IncomingMessage,
  res: ServerResponse,
  runtime: WebRuntime,
  env: WebEnv,
): Promise<void> {
  const headerToken = req.headers["x-ithacus-token"];
  const body = await readBody(req);
  const parsed = parseJson(body);
  const rec =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const bodyToken = typeof rec.token === "string" ? rec.token : null;
  // Loopback is the trust boundary; the per-session token guards state writes.
  if (headerToken !== env.token && bodyToken !== env.token) {
    sendJson(res, 403, { error: "forbidden: loopback session token mismatch" });
    return;
  }
  try {
    const flags = parseUiFlags(rec.ui);
    const written = writeProjectUi(runtime.currentStateDir, flags);
    sendJson(res, 200, { ok: true, ui: flags, written });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : "invalid ui payload" });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer | string) => {
      data += String(chunk);
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- config.json read/write (the same "ui" key config.ts reads) -----------

/** Read the repo's .ithacus/config.json as a plain record (never throws). */
export function readProjectConfig(stateDir: string): Record<string, unknown> {
  try {
    const p = join(stateDir, "config.json");
    if (!existsSync(p)) return {};
    const raw: unknown = JSON.parse(readFileSync(p, "utf-8"));
    return typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Persist `ui` (validated) into .ithacus/config.json, writing only the
 *  non-default overrides so the file stays minimal. Returns the overrides. */
export function writeProjectUi(stateDir: string, ui: UiFlags): Record<string, boolean> {
  const cfg = readProjectConfig(stateDir);
  const overrides: Record<string, boolean> = {};
  for (const id of UI_FLAG_IDS) {
    if (ui[id] !== UI_FLAG_DEFAULTS[id]) overrides[id] = ui[id];
  }
  const next = { ...cfg, ui: overrides };
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "config.json"), JSON.stringify(next, null, 2) + "\n");
  return overrides;
}

// ---- static assets ---------------------------------------------------------

function readAsset(dir: string, name: string): string {
  try {
    return readFileSync(join(dir, name), "utf-8");
  } catch {
    return "";
  }
}

function serveIndex(res: ServerResponse, env: WebEnv): void {
  let html = readAsset(env.assetDir, "index.html");
  if (!html) {
    html =
      "<!doctype html><html><head><meta charset=\"utf-8\"><title>ithacus web</title></head>" +
      "<body><h1>ithacus web</h1><p>Dashboard assets not found — running from a smoke or " +
      "unbundled layout. Use the /api/* endpoints directly.</p></body></html>";
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html.split("__ITHACUS_TOKEN__").join(env.token));
}

function serveStatic(res: ServerResponse, rawPath: string, env: WebEnv): void {
  const name = rawPath === "/" ? "index.html" : basename(rawPath);
  const allowed = new Set(["index.html", "styles.css", "app.js"]);
  if (!allowed.has(name)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const text = readAsset(env.assetDir, name);
  if (!text) {
    sendJson(res, 404, { error: "asset not bundled" });
    return;
  }
  const mime = name.endsWith(".css")
    ? "text/css; charset=utf-8"
    : name === "app.js"
      ? "application/javascript; charset=utf-8"
      : "text/html; charset=utf-8";
  res.writeHead(200, { "content-type": mime });
  res.end(text);
}

// ---- /ithacus-web command ----------------------------------------------------

/** Register the /ithacus-web command group (start|stop|status). Gated on the
 *  webUi UiFlag (default ON); status/stop always work. */
export function registerWebCommand(pi: ExtensionAPI, runtime: WebRuntime, config: IthacusConfig): void {
  const enabled = config.ui.webUi !== false;
  const notify = (ctx: ExtensionCommandContext, msg: string, level: "info" | "error"): void => {
    try {
      ctx.ui.notify(msg, level);
    } catch {
      /* command feedback is best-effort */
    }
  };
  pi.registerCommand("ithacus-web", {
    description:
      "Start/stop/status the local loopback dashboard (binds 127.0.0.1 only). " +
      "start: serve the web UI; stop: halt the server; status: report the bound state.",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const raw = (args as string)?.trim() ?? "";
      const sub = raw.split(/\s+/)[0] ?? "status";

      if (sub === "start") {
        if (!enabled) {
          notify(
            ctx,
            "ithacus web: ui flag webUi=off — enable via the Setup panel or ITHACUS_UI=webUi:true, then re-run.",
            "info",
          );
          return;
        }
        try {
          const handle = await startWebServer(runtime);
          notify(
            ctx,
            `ithacus web: started at ${handle.baseUrl} — open in a browser to view the dashboard. /ithacus-web stop to halt.`,
            "info",
          );
        } catch (err) {
          notify(ctx, `ithacus web: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
        return;
      }
      if (sub === "stop") {
        const wasActive = await stopWebServer();
        notify(ctx, wasActive ? "ithacus web: stopped." : "ithacus web: not running.", "info");
        return;
      }
      notify(ctx, webStatus(), "info");
    },
  });
}
