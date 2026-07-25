/**
 * stream-rules.ts — regex-based rules that fire on pattern match during
 * live text generation, injecting guidance mid-stream.
 *
 * Rules persist across context compaction (compaction survival) by being
 * re-applied to the post-compact transcript.
 *
 * pi-agnostic.
 */

import type { StreamRule } from './types.js';

let ruleCounter = 0;

/** Mutable per-session rule registry (in-memory; compaction-safe by design). */
class StreamRuleRegistry {
  private rules = new Map<string, StreamRule>();
  private fireCounts = new Map<string, number>();

  /** Register a rule. Returns the created rule (id assigned). */
  add(opts: { pattern: string; flags?: string; inject: string; persistAfterCompaction?: boolean; maxFires?: number }): StreamRule {
    const id = `rule-${++ruleCounter}`;
    const rule: StreamRule = {
      id,
      pattern: opts.pattern,
      flags: opts.flags ?? 'i',
      inject: opts.inject,
      persistAfterCompaction: opts.persistAfterCompaction ?? true,
      maxFires: opts.maxFires ?? 0,
      createdAt: Date.now(),
    };
    this.rules.set(id, rule);
    this.fireCounts.set(id, 0);
    return rule;
  }

  get(id: string): StreamRule | undefined { return this.rules.get(id); }
  list(): StreamRule[] { return [...this.rules.values()]; }
  remove(id: string): boolean {
    this.fireCounts.delete(id);
    return this.rules.delete(id);
  }
  clear(): void { this.rules.clear(); this.fireCounts.clear(); }

  /**
   * Scan text for rule matches and return injections to apply.
   * Skips rules that have hit maxFires (when > 0) or have been disabled.
   */
  scan(text: string): Array<{ ruleId: string; inject: string }> {
    const out: Array<{ ruleId: string; inject: string }> = [];
    for (const rule of this.rules.values()) {
      const fired = this.fireCounts.get(rule.id) ?? 0;
      if (rule.maxFires > 0 && fired >= rule.maxFires) continue;
      let regex: RegExp;
      try { regex = new RegExp(rule.pattern, rule.flags); }
      catch { continue; } // invalid pattern: skip silently
      if (regex.test(text)) {
        const inject = this.expandCaptures(text, rule);
        out.push({ ruleId: rule.id, inject });
        this.fireCounts.set(rule.id, fired + 1);
      }
    }
    return out;
  }

  /** Expand $0, $1, ... captures from the first match. */
  private expandCaptures(text: string, rule: StreamRule): string {
    try {
      // Drop the global flag so String.match returns capture groups (with `g`
      // it only returns full matches and drops captures).
      const flags = rule.flags.replace(/g/g, '');
      const re = new RegExp(rule.pattern, flags);
      const m = text.match(re);
      if (!m) return rule.inject;
      let out = rule.inject;
      m.forEach((cap, i) => {
        if (cap !== undefined) out = out.replaceAll(`$${i}`, cap);
      });
      return out;
    } catch {
      return rule.inject;
    }
  }

  /**
   * After a compaction, re-register persistent rules + reset fire counts so
   * they can fire again in the post-compact context. Returns the count of
   * rules that survived.
   */
  surviveCompaction(): number {
    let count = 0;
    for (const [id, rule] of this.rules) {
      if (!rule.persistAfterCompaction) {
        this.rules.delete(id);
        this.fireCounts.delete(id);
      } else {
        this.fireCounts.set(id, 0);
        count++;
      }
    }
    return count;
  }
}

/** Create a fresh registry (one per session). */
export function createStreamRuleRegistry(): StreamRuleRegistry {
  return new StreamRuleRegistry();
}

/** Functional helpers (operate on explicit rule lists, no registry state). */

/** Compile + validate a rule's pattern. Returns the RegExp or null. */
export function compileRule(rule: Pick<StreamRule, 'pattern' | 'flags'>): RegExp | null {
  try { return new RegExp(rule.pattern, rule.flags); } catch { return null; }
}

/** Test whether a rule matches text (no side effects). */
export function ruleMatches(rule: Pick<StreamRule, 'pattern' | 'flags'>, text: string): boolean {
  const re = compileRule(rule);
  return re ? re.test(text) : false;
}

/** Whether a rule survives compaction. */
export function survivesCompaction(rule: Pick<StreamRule, 'persistAfterCompaction'>): boolean {
  return rule.persistAfterCompaction;
}
