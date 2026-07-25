/**
 * types-sprint-4.3.ts — Sprint 4.3 TUI + Collab types (split from types.ts
 * because types.ts is at 299/300; pure declarations, no logic).
 * Re-exported by types.ts so existing './types.js' imports are unchanged.
 */

/** A TUI tool card (rendered output). */
export interface ToolCard {
  id: string;
  /** card title shown in header. */
  title: string;
  /** markdown/text body. */
  body: string;
  /** 'tool_call' | 'tool_result' | 'ask' | 'info'. */
  kind: 'tool_call' | 'tool_result' | 'ask' | 'info';
  /** collapsed? */
  collapsed: boolean;
}

/** An edit preview (before/after diff). */
export interface EditPreview {
  filePath: string;
  before: string;
  after: string;
  /** unified diff lines. */
  diffHunks: string[];
}

/** An ask picker option. */
export interface AskOption {
  id: string;
  label: string;
  /** whether this option is selected. */
  selected: boolean;
}

/** A QR code payload. */
export interface QrCode {
  /** text encoded in the QR. */
  text: string;
  /** ASCII rendering of the QR (for text TUIs). */
  ascii: string;
  /** size in modules. */
  size: number;
}

/** A collab session participant. */
export interface CollabParticipant {
  id: string;
  /** display name. */
  name: string;
  /** 'read-write' | 'read-only'. */
  role: 'read-write' | 'read-only';
  /** whether the participant is online. */
  online: boolean;
  joinedAt: number;
}

/** A collab session with participants + shared transcript. */
export interface CollabSession {
  id: string;
  /** shareable invite token. */
  token: string;
  participants: CollabParticipant[];
  /** whether the session is active. */
  active: boolean;
  createdAt: number;
}

/** A collab relay message (broadcast to participants). */
export interface CollabMessage {
  id: string;
  sessionId: string;
  fromId: string;
  /** 'edit' | 'chat' | 'presence' | 'cursor'. */
  kind: 'edit' | 'chat' | 'presence' | 'cursor';
  payload: unknown;
  ts: number;
}
