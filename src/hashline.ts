/**
 * hashline.ts — content-hash anchored edit format.
 *
 * Reduces edit token cost by anchoring edits to a content hash instead of
 * repeating large oldString blocks. On apply, the hash is verified; if stale,
 * a nearest-match recovery finds the closest occurrence within a tolerance
 * (default 3 lines) before falling back to the native edit format.
 *
 * pi-agnostic: uses only node:crypto + node:fs helpers.
 */

import { createHash } from 'node:crypto';
import type { HashlineEdit, NativeEdit } from './types.js';

/** Maximum line drift tolerated by stale-anchor recovery (acceptance: <=3). */
export const STALE_MATCH_TOLERANCE = 3;

/**
 * Compute the SHA-256 hash (hex) of file content (the anchor for an edit).
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Build a HashlineEdit from a target file's current content + the old/new text.
 * The anchorHash pins the edit to the exact `oldText` retrieved from content.
 */
export function buildHashline(
  filePath: string,
  oldText: string,
  newText: string,
  anchorLine?: number,
): HashlineEdit {
  return {
    filePath,
    anchorHash: computeHash(oldText),
    oldText,
    newText,
    ...(anchorLine !== undefined ? { anchorLine } : {}),
  };
}

/**
 * Serialize a HashlineEdit to the compact wire format (token-efficient):
 *   @@filepath|<hash>[@line]
 *   <<<OLD
 *   <oldText>
 *   >>>NEW
 *   <newText>
 *   ===
 */
export function serializeHashline(edit: HashlineEdit): string {
  const header = edit.anchorLine != null
    ? `@@${edit.filePath}|${edit.anchorHash}@${edit.anchorLine}`
    : `@@${edit.filePath}|${edit.anchorHash}`;
  return [header, '<<<OLD', edit.oldText, '>>>NEW', edit.newText, '==='].join('\n');
}

/**
 * Parse the wire format back into a HashlineEdit. Throws on malformed input.
 */
export function parseHashline(text: string): HashlineEdit {
  const lines = text.split('\n');
  if (lines.length < 6 || !lines[0]?.startsWith('@@')) {
    throw new Error('malformed hashline header');
  }
  const header = lines[0].slice(2); // drop @@
  // header = filepath|hash[@line]
  const linePart = header.includes('@') ? header.slice(header.lastIndexOf('@')) : '';
  let anchorLine: number | undefined;
  let rest = header;
  if (linePart) {
    anchorLine = parseInt(linePart.slice(1), 10);
    rest = header.slice(0, header.lastIndexOf('@'));
  }
  const pipeIdx = rest.indexOf('|');
  if (pipeIdx < 0) throw new Error('malformed hashline: missing | separator');
  const filePath = rest.slice(0, pipeIdx);
  const anchorHash = rest.slice(pipeIdx + 1);
  if (lines[1] !== '<<<OLD') throw new Error('missing <<<OLD marker');
  const newMarker = lines.indexOf('>>>NEW');
  if (newMarker < 0) throw new Error('missing >>>NEW marker');
  const oldText = lines.slice(2, newMarker).join('\n');
  if (lines[newMarker + 1] === undefined) throw new Error('empty new block');
  const endMarker = lines.lastIndexOf('===');
  if (endMarker < 0) throw new Error('missing === terminator');
  const newText = lines.slice(newMarker + 1, endMarker).join('\n');
  const result: HashlineEdit = { filePath, anchorHash, oldText, newText };
  if (anchorLine !== undefined) result.anchorLine = anchorLine;
  return result;
}

/**
 * Apply a HashlineEdit to file content. Returns the edited content + a status
 * describing whether the anchor matched, was recovered, or fell back.
 * @throws if the edit cannot be applied (oldText not found within tolerance).
 */
export function applyHashline(
  content: string,
  edit: HashlineEdit,
  opts: { tolerance?: number } = {},
): { content: string; status: 'exact' | 'recovered' | 'fallback' | 'failed' } {
  const tolerance = opts.tolerance ?? STALE_MATCH_TOLERANCE;
  const actualHash = computeHash(edit.oldText);
  // Exact match: anchor hash matches and oldText is present in content.
  // (Empty oldText is a pure-insertion request, not an exact replace.)
  if (edit.oldText.length > 0 && actualHash === edit.anchorHash && content.includes(edit.oldText)) {
    return { content: content.replace(edit.oldText, edit.newText), status: 'exact' };
  }
  // Stale anchor: try nearest-match recovery within tolerance lines.
  const recovered = findNearestMatch(content, edit.oldText, tolerance);
  if (recovered.match) {
    return {
      content: content.replace(recovered.match, edit.newText),
      status: recovered.drift === 0 ? 'exact' : 'recovered',
    };
  }
  // Fallback: if oldText is empty or absent, attempt a pure insertion at anchorLine.
  if (edit.oldText === '' && edit.anchorLine != null) {
    const lines = content.split('\n');
    const idx = Math.min(edit.anchorLine - 1, lines.length);
    lines.splice(idx, 0, edit.newText);
    return { content: lines.join('\n'), status: 'fallback' };
  }
  return { content, status: 'failed' };
}

/**
 * Stale-anchor recovery: find the nearest occurrence of `needle` in `content`
 * by fuzzy line-count match. If the exact string is present, drift=0.
 * Otherwise normalizes whitespace per line and finds the strip within tolerance.
 */
export function findNearestMatch(
  content: string,
  needle: string,
  tolerance = STALE_MATCH_TOLERANCE,
): { match: string | null; drift: number } {
  if (content.includes(needle)) return { match: needle, drift: 0 };
  if (!needle.trim()) return { match: null, drift: tolerance + 1 };
  const contentLines = content.split('\n');
  const needleLines = needle.split('\n');
  const nNeedle = needleLines.length;
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
  const normNeedle = needleLines.map(norm);
  // Slide a window over content comparing normalized lines. A window is a
  // candidate only if (a) its mismatched-line count is within tolerance AND
  // (b) it is character-similar to the needle (gate stops unrelated
  // single-line needles from spuriously matching at drift=1).
  let bestDrift = tolerance + 1;
  let bestSlice: string | null = null;
  for (let i = 0; i + nNeedle <= contentLines.length; i++) {
    const slice = contentLines.slice(i, i + nNeedle);
    const mismatches = slice.reduce(
      (acc, line, j) => acc + (norm(line) !== normNeedle[j] ? 1 : 0),
      0,
    );
    if (mismatches > tolerance || mismatches >= bestDrift) continue;
    if (similarity(norm(slice.join('\n')), normNeedle.join('\n')) < 0.5) continue;
    bestDrift = mismatches;
    bestSlice = slice.join('\n');
  }
  return { match: bestSlice, drift: bestDrift };
}

/**
 * Normalized character-similarity ratio in [0,1] (1 = identical).
 * Uses Levenshtein distance: 1 - dist / max(len). Used to gate fuzzy
 * matches so that totally-unrelated lines are not treated as nearby.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 && lb === 0) return 1;
  const max = Math.max(la, lb);
  if (max === 0) return 1;
  // Two rolling arrays for Levenshtein.
  let prev = new Array(lb + 1);
  let curr = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  const dist = prev[lb];
  return 1 - dist / max;
}

// ---- native format conversion --------------------------------------------

/** Convert a HashlineEdit to pi's native Edit-tool shape (drop the hash). */
export function toNativeEdit(edit: HashlineEdit): NativeEdit {
  return { filePath: edit.filePath, oldString: edit.oldText, newString: edit.newText };
}

/** Convert a native edit into a HashlineEdit (computes the anchor hash). */
export function fromNativeEdit(native: NativeEdit): HashlineEdit {
  return {
    filePath: native.filePath,
    anchorHash: computeHash(native.oldString),
    oldText: native.oldString,
    newText: native.newString,
  };
}

/**
 * Estimate token reduction of the hashline wire format vs the native format
 * (oldString + newString repeated in full). Returns a fraction in [0,1).
 */
export function tokenReduction(native: NativeEdit, hashline?: HashlineEdit): number {
  // Native format transmits oldString + newString in full.
  // Hashline anchors the old text against a fixed-size hash (no re-send),
  // so its effective payload is hash + newText.
  const hl = hashline ?? fromNativeEdit(native);
  const nativeSize = native.oldString.length + native.newString.length;
  const hashlineSize = hl.anchorHash.length + hl.newText.length;
  if (nativeSize === 0) return 0;
  return Math.max(0, 1 - hashlineSize / nativeSize);
}
