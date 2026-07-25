/**
 * collab.ts — collaborative relay with an injectable transport.
 *
 * pi-agnostic: src/ never opens a network/IPC channel (PREVENT-ITH-004).
 * The relay transport is injected (DI) so the client is fully unit-testable
 * with a mock; the extension layer wires a real collab relay (which carries
 * the guardrails-allow PREVENT-ITH-004 exception annotation).
 */

import type { CollabSession, CollabParticipant, CollabMessage } from './types.js';

/** Injectable collab relay transport. */
export interface CollabRelay {
  /** Create a new collab session (returns the session with a token). */
  createSession(host: CollabParticipant): Promise<CollabSession>;
  /** Join a session by token. */
  joinSession(token: string, participant: CollabParticipant): Promise<CollabSession>;
  /** Leave a session. */
  leaveSession(sessionId: string, participantId: string): Promise<void>;
  /** Broadcast a message to all participants. */
  broadcast(msg: CollabMessage): Promise<void>;
  /** Subscribe to incoming messages (returns unsubscribe). */
  subscribe(sessionId: string, handler: (msg: CollabMessage) => void): Promise<() => void>;
  /** List participants in a session. */
  listParticipants(sessionId: string): Promise<CollabParticipant[]>;
}

/** The collab client: wraps an injected relay with typed methods. */
export class CollabClient {
  readonly relay: CollabRelay;
  private sessions = new Map<string, CollabSession>();
  private myId: string;

  constructor(relay: CollabRelay, myId: string) {
    this.relay = relay;
    this.myId = myId;
  }

  /** Host a new session; returns the shareable token. */
  async host(name: string): Promise<string> {
    const host: CollabParticipant = { id: this.myId, name, role: 'read-write', online: true, joinedAt: Date.now() };
    const session = await this.relay.createSession(host);
    this.sessions.set(session.id, session);
    return session.token;
  }

  /** Join a session by token. */
  async join(token: string, name: string, readWrite = false): Promise<CollabSession> {
    const participant: CollabParticipant = { id: this.myId, name, role: readWrite ? 'read-write' : 'read-only', online: true, joinedAt: Date.now() };
    const session = await this.relay.joinSession(token, participant);
    this.sessions.set(session.id, session);
    return session;
  }

  /** Leave a session. */
  async leave(sessionId: string): Promise<void> {
    await this.relay.leaveSession(sessionId, this.myId);
    this.sessions.delete(sessionId);
  }

  /** Send a chat message. */
  async sendChat(sessionId: string, text: string): Promise<void> {
    await this.relay.broadcast({ id: `msg-${Date.now()}`, sessionId, fromId: this.myId, kind: 'chat', payload: text, ts: Date.now() });
  }

  /** Send an edit event. */
  async sendEdit(sessionId: string, edit: unknown): Promise<void> {
    await this.relay.broadcast({ id: `msg-${Date.now()}`, sessionId, fromId: this.myId, kind: 'edit', payload: edit, ts: Date.now() });
  }

  /** Send a cursor/presence event. */
  async sendPresence(sessionId: string, cursor: unknown): Promise<void> {
    await this.relay.broadcast({ id: `msg-${Date.now()}`, sessionId, fromId: this.myId, kind: 'cursor', payload: cursor, ts: Date.now() });
  }

  /** Subscribe to incoming messages. */
  async onMessage(sessionId: string, handler: (msg: CollabMessage) => void): Promise<() => void> {
    return this.relay.subscribe(sessionId, handler);
  }

  /** List participants in a session. */
  async participants(sessionId: string): Promise<CollabParticipant[]> {
    return this.relay.listParticipants(sessionId);
  }

  /** Get a tracked session by id. */
  session(sessionId: string): CollabSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Generate a read-only invite token for a session (host-only). */
  async generateReadOnlyLink(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`collab: session not found: ${sessionId}`);
    // In a real implementation this would mint a scoped read-only token server-side;
    // here we synthesize one from the session token + a role suffix.
    return `${session.token}:ro`;
  }

  /** Leave all tracked sessions. */
  async leaveAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map(id => this.relay.leaveSession(id, this.myId).catch(() => undefined)));
    this.sessions.clear();
  }
}

/** Create a collab client over an injected relay. */
export function createCollabClient(relay: CollabRelay, myId: string): CollabClient {
  return new CollabClient(relay, myId);
}
