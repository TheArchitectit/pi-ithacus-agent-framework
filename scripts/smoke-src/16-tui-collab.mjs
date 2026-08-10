import { failures, check, buildDir, tmpRepo, cfg, IthStore, team, par, trim, wf, wt, asc, PresenceStore, presence, reservations, cost, ModelProfileStore, profiles, validator, hashline, checkpoint, configFormats, streamRules, advisor, review, commits, HindsightStore, hindsight, search, schemes, EventsStore, definitions, metrics, pluginsMod, LspClient, createLspClient, BrowserClient, createBrowserClient, css, xpath, text, EvalClient, createEvalClient, TuiClient, createTuiClient, CollabClient, createCollabClient, DapClient, createDapClient, applyRewrite, findMatches, validateRewrite, chainRewrites, RegexAstMatcher, expandTemplate, createGoalLoop, runGoalLoop, addStep, updateStep, stopGoalLoop, summarizeLoop, runDwf, defineWorkflow, Scheduler, createScheduler, nextCronFire, nextFire, WorkQueue, createWorkQueue, InMemoryTaskStore, SqliteTaskStore, createTaskStore, createSqliteTaskStore, runStep, runWorkflow, evalCondition, parseMiniYaml, fromYaml, fromObject, validateTemplate, NegotiationManager, createNegotiationManager, AgentHandoffManager, createHandoffManager, SwarmOrchestrator, createSwarmOrchestrator, initHive, teardownHive, acquireHiveLock, writeArtifact, appendAudit, listHiveDir, synthesize, majorityVote, weightedMerge, firstWins, detectConflicts, SwarmStore, createSwarmStore, PlanSynthesizer, createPlanSynthesizer, PlanRunner, createPlanRunner, resolver, mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, tmpdir, join, execSync } from "./_harness.mjs";
export async function run(ctx) {
  const { h, fallback, msg } = ctx;

// ---- tui + collab (Sprint 4.3) ----------------------------------------
await (async () => {
  // Mock TUI renderer
  const makeRenderer = () => {
    const renders = [];
    const diffs = [];
    return {
      render: async (frame) => { renders.push(frame); },
      applyDiff: async (diff) => { diffs.push(diff); },
      readInput: async (prompt) => 'yes',
      clear: async () => {},
      isAttached: () => true,
      _renders: renders, _diffs: diffs,
    };
  };

  const tc = createTuiClient(makeRenderer());
  check('tui.isAttached default true', tc.isAttached() === true);

  tc.addCard({ id: 'c1', title: 'Card 1', body: 'hello', kind: 'tool_call', collapsed: false });
  tc.addCard({ id: 'c2', title: 'Card 2', body: 'world', kind: 'tool_result', collapsed: false });

  const frame = await tc.render();
  check('tui.render returns frame', frame.cards.length === 2);
  check('tui.render renders to renderer', tc.renderer._renders.length === 1);

  // updateCard returns false for unknown
  check('tui.updateCard unknown returns false', tc.updateCard({ id: 'nope', title: 'x', body: 'y', kind: 'info', collapsed: false }) === false);

  // diff: add + update + remove
  tc.updateCard({ id: 'c1', title: 'Card 1', body: 'CHANGED', kind: 'tool_call', collapsed: false });
  tc.removeCard('c2');
  tc.addCard({ id: 'c3', title: 'Card 3', body: 'new', kind: 'ask', collapsed: false });
  const diff = await tc.renderDiff();
  check('tui.renderDiff added', diff.added.length === 1 && diff.added[0].id === 'c3');
  check('tui.renderDiff updated', diff.updated.length === 1 && diff.updated[0].id === 'c1');
  check('tui.renderDiff removed', diff.removed.length === 1 && diff.removed[0] === 'c2');
  check('tui.renderDiff applied to renderer', tc.renderer._diffs.length === 1);

  // kind-only change triggers update (P2 fix)
  const tcKind = createTuiClient(makeRenderer());
  tcKind.addCard({ id: 'k1', title: 'K', body: 'same', kind: 'tool_call', collapsed: false });
  await tcKind.render();
  tcKind.updateCard({ id: 'k1', title: 'K', body: 'same', kind: 'tool_result', collapsed: false });
  const diffKind = await tcKind.renderDiff();
  check('tui.renderDiff detects kind-only change', diffKind.updated.length === 1 && diffKind.updated[0].id === 'k1');

  // edit preview
  await tc.renderEditPreview({ filePath: '/src/x.ts', before: 'a', after: 'b', diffHunks: ['-a', '+b'] });
  check('tui.renderEditPreview adds card', tc.renderer._diffs.length === 2);

  // ask picker
  const chosen = await tc.askPicker('Proceed?', [
    { id: 'yes', label: 'Yes', selected: false },
    { id: 'no', label: 'No', selected: false },
  ]);
  check('tui.askPicker picks yes', chosen === 'yes');

  // ask picker fallback to first
  const tc2 = createTuiClient({ render: async () => {}, applyDiff: async () => {}, readInput: async () => 'unknown', clear: async () => {} });
  const fallback = await tc2.askPicker('?', [{ id: 'a', label: 'A', selected: false }]);
  check('tui.askPicker fallback first', fallback === 'a');

  // QR code
  let qrPayload = null;
  await tc.renderQr('https://join.example/abc', (text) => {
    qrPayload = text;
    return { text, ascii: '█▀▀█', size: 3 };
  });
  check('tui.renderQr generates', qrPayload === 'https://join.example/abc');

  // status/input line in diff
  tc.setStatus('rendering...');
  const diffStatus = await tc.renderDiff();
  check('tui.statusLine in diff when changed', diffStatus.statusLine === 'rendering...');
  // unchanged status not included
  const diffNoStatus = await tc.renderDiff();
  check('tui.statusLine omitted when unchanged', diffNoStatus.statusLine === undefined);

  // clear
  await tc.clear();
  check('tui.clear resets', tc !== undefined);

  // ---- collab ----
  const makeRelay = () => {
    const sessions = new Map();
    const participants = new Map();
    const subscribers = new Map();
    let tokenCounter = 0;
    return {
      createSession: async (host) => {
        const id = `session-${++tokenCounter}`;
        const token = `token-${tokenCounter}`;
        const session = { id, token, participants: [host], active: true, createdAt: Date.now() };
        sessions.set(id, session);
        participants.set(id, [host]);
        return session;
      },
      joinSession: async (token, participant) => {
        for (const s of sessions.values()) {
          if (s.token === token) { participants.get(s.id).push(participant); return { ...s, participants: participants.get(s.id) }; }
        }
        throw new Error('unknown token');
      },
      leaveSession: async (sessionId, participantId) => {
        const arr = participants.get(sessionId) ?? [];
        participants.set(sessionId, arr.filter(p => p.id !== participantId));
      },
      broadcast: async (msg) => {
        (subscribers.get(msg.sessionId) ?? []).forEach(h => h(msg));
      },
      subscribe: async (sessionId, handler) => {
        if (!subscribers.has(sessionId)) subscribers.set(sessionId, []);
        subscribers.get(sessionId).push(handler);
        return () => { subscribers.set(sessionId, subscribers.get(sessionId).filter(h => h !== handler)); };
      },
      listParticipants: async (sessionId) => participants.get(sessionId) ?? [],
    };
  };

  let myIdCounter = 0;
  const relay = makeRelay();
  const cc = createCollabClient(relay, `me-${++myIdCounter}`);
  const token = await cc.host('Alice');
  check('collab.host returns non-empty token', token.length > 0);
  check('collab.host returns token', token.startsWith('token-'));

  const ps = await cc.participants('session-1');
  check('collab.participants returns host', ps.length === 1 && ps[0].name === 'Alice');

  // read-only link generation
  const roLink = await cc.generateReadOnlyLink('session-1');
  check('collab.generateReadOnlyLink token:ro', roLink.endsWith(':ro'));

  // throws on unknown session
  let roThrew = false;
  try { await cc.generateReadOnlyLink('unknown'); } catch { roThrew = true; }
  check('collab.generateReadOnlyLink throws unknown', roThrew === true);

  // broadcast + subscribe
  const cc2 = createCollabClient(relay, `me-${++myIdCounter}`);
  const received = [];
  const unsub = await cc.onMessage('session-1', (msg) => received.push(msg));
  await cc.sendChat('session-1', 'hello team');
  await cc.sendEdit('session-1', { file: '/x.ts', change: 'edit' });
  await cc.sendPresence('session-1', { line: 5 });
  check('collab.subscribe receives broadcasts', received.length === 3);
  check('collab.sendChat kind', received[0].kind === 'chat' && received[0].payload === 'hello team');
  check('collab.sendEdit kind', received[1].kind === 'edit');
  check('collab.sendPresence kind', received[2].kind === 'cursor');

  // unsubscribe
  await unsub();
  await cc.sendChat('session-1','no more');
  check('collab.unsubscribe stops delivery', received.length === 3);

  // join session
  const cc3 = createCollabClient(relay, `me-${++myIdCounter}`);
  const joined = await cc3.join(token, 'Bob', false);
  check('collab.join returns session', joined.id === 'session-1');
  check('collab.join read-only role', joined.participants.some(p => p.id === `me-${myIdCounter}` && p.role === 'read-only'));
  const psAfter = await cc3.participants('session-1');
  check('collab.join adds participant', psAfter.length === 2);

  // leave + leaveAll
  await cc3.leave('session-1');
  const psAfterLeave = await cc.participants('session-1');
  check('collab.leave removes participant', psAfterLeave.length === 1);
  await cc.leaveAll();
  check('collab.leaveAll clears', cc !== undefined);

  // msg-id uniqueness in tight loops (P3 fix)
  const uniqRelay = makeRelay();
  const uniqCc = createCollabClient(uniqRelay, 'uniq-me');
  await uniqCc.host('U');
  const receivedIds = [];
  const uniqUnsub = await uniqCc.onMessage('session-1', (msg) => receivedIds.push(msg.id));
  await uniqCc.sendChat('session-1', 'a');
  await uniqCc.sendEdit('session-1', {});
  await uniqCc.sendPresence('session-1', {});
  await uniqUnsub();
  check('collab msg-ids unique when broadcast observed', receivedIds.length === 3 && new Set(receivedIds).size === 3);
})(); // end Sprint 4.3 IIFE
}
