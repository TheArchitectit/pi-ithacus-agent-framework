/**
 * src/redact.ts — secret redaction (Sprint 5.15, DESIGN_PERMISSION_MODES.md
 * audit requirement + AGENT_GUARDRAILS "NO SECRETS").
 *
 * pi-agnostic + PURE: zero imports, zero network (PREVENT-ITH-004), safe
 * under Node's --experimental-strip-types. Bounded regex list — every
 * quantifier is bounded or simple-linear (no nested-quantifier backtracking).
 *
 * Anything written to the live store's previews, the appendEvent audit log,
 * or the dispatch header was reachable by a sub-agent's tool args — so tool
 * output previews and audit records get scrubbed BEFORE they are persisted
 * or shown.
 */

/** Replacement marker applied wherever a secret-shaped span matched. */
export const REDACT_MASK = "REDACTED";

// Ordered: specific patterns first, generic long-token last.
// Note: the mask is wrapped in asterisks below ("***REDACTED***"); keeping the
// bare marker here keeps the constant pattern-scan neutral.
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // PEM-style private key blocks (multi-line, bounded body).
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{0,4096}?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "***REDACTED***"],
  // AWS-style access key ids.
  [/\b(AKIA|ASIA)[0-9A-Z]{16,20}\b/g, "***REDACTED***"],
  // GitHub-style prefixed tokens (ghp_/gho_/ghu_/ghs_/ghr_).
  [/\bgh[pousr]_[A-Za-z0-9]{6,40}\b/g, "***REDACTED***"],
  // Authorization: Bearer <token>
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, "$1***REDACTED***"],
  // password=/token=/api_key=/secret= style assignments (the value is dropped).
  [/\b(password|passwd|pwd|secret|token|apikey|api[-_]?key|access[-_]?key|auth[-_]?token|client[-_]?secret|refresh[-_]?token)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1$2***REDACTED***"],
  // Long hex/base64url runs (>=32 chars) — generic credential shapes.
  // NOTE: `/` is deliberately excluded from the class so file paths and URLs
  // (which contain `/` separators) are not false-positive masked. This was the
  // root cause of the "cd / ***REDACTED***" bug — a 32+ char path matched as
  // one contiguous token. Base64 tokens that DO contain `/` are still caught by
  // the Bearer / password= / PEM patterns above; the catch-all here is a net
  // for bare hex and base64url tokens (no slashes) which are the common shapes
  // for API keys and hash-based credentials.
  [/\b[A-Za-z0-9+_=-]{32,}\b/g, "***REDACTED***"],
];

/** Mask known secret shapes in a string. Unknown text passes through verbatim. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

/**
 * Redact + truncate a tool-args preview to maxLen chars (defaults to the
 * live store's 60-char preview convention; the file preview uses 80).
 * Redact FIRST so a secret can never survive in partially-truncated form.
 */
export function redactToolArgs(args: string, maxLen?: number): string {
  const limit = maxLen ?? 60;
  const clean = redactSecrets(args);
  return clean.length > limit ? clean.slice(0, limit) : clean;
}

/**
 * Shallow redact of string (and string-array) values in an audit record —
 * shape is preserved key-for-key (non-string values pass through untouched).
 * Used for appendEvent("permission_resolved", ...) so resolvedTools + agent
 * provenance land in the audit log already scrubbed.
 */
export function redactForAudit(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      out[k] = redactSecrets(v);
    } else if (
      Array.isArray(v) &&
      v.every((item) => typeof item === "string")
    ) {
      out[k] = v.map((item) => redactSecrets(item as string));
    } else {
      out[k] = v;
    }
  }
  return out;
}
