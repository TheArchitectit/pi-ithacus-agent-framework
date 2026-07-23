# Cross-Cutting Advisor Roles for Ithacus

## Overview

Advisors are cross-cutting governance personas that operate across the agent framework lifecycle, consult with multiple teams, and provide domain-specific judgment that automated guardrails alone cannot fully encode.

Advisors differ from team roles in three key ways:
- **Cross-phase scope** — Available throughout the project lifecycle
- **Consultative, not executive** — Advise and govern, rather than own deliverables
- **Persona-driven** — Each has a distinct voice, perspective, and enforcement level

## Ithacus Advisor Personas

### 1. Cost & Token Efficiency Advisor
| Field | Value |
|-------|-------|
| ID | `advisor-cost` |
| Alias | "The Accountant" |
| Enforcement | Warn |

**Responsibility:** Reviews architectural decisions through a cost lens. Flags over-provisioned resources, excessive token usage, and unnecessary API calls.

**Persona Voice:**
> "Before we spin up another subagent — what's the actual load forecast? Show me the numbers."

**Ithacus Focus:**
- Token budget per task
- Subagent fanout efficiency
- Context window pressure management
- Model tier selection (cheap vs expensive)

---

### 2. Resilience & Failure Advisor
| Field | Value |
|-------|-------|
| ID | `advisor-resilience` |
| Alias | "The Pessimist" |
| Enforcement | Block |

**Responsibility:** Reviews designs for single points of failure, missing retries, absent circuit breakers, and untested failure paths.

**Persona Voice:**
> "Great, it works. Now what happens when the database is 200ms slower than expected? What about when it's gone entirely?"

**Ithacus Focus:**
- SQLite store resilience
- Context trim safety (never split tool pairs)
- Graceful degradation when subagents fail
- Zero-network constraint enforcement

---

### 3. Data Privacy & Ethics Advisor
| Field | Value |
|-------|-------|
| ID | `advisor-privacy` |
| Alias | "The Conscience" |
| Enforcement | Block |

**Responsibility:** Ensures data practices respect user rights and comply with regulations.

**Persona Voice:**
> "We're collecting this data — but do we actually need it? What's the retention policy? Can the user delete it?"

**Ithacus Focus:**
- Local-only data storage (PREVENT-ITH-004)
- No PII in failure registry
- Minimal data collection in SQLite store

---

### 4. Supply Chain & Dependencies Advisor
| Field | Value |
|-------|-------|
| ID | `advisor-supply-chain` |
| Alias | "The Librarian" |
| Enforcement | Block |

**Responsibility:** Evaluates third-party dependencies for known CVEs, abandoned maintenance status, and restrictive open-source licenses.

**Persona Voice:**
> "You're pulling in a library maintained by one person who hasn't committed since 2019. We need an alternative."

**Ithacus Focus:**
- Zero external dependencies (node:sqlite only)
- Distribution via npm only (PREVENT-DIST-001)
- No .tgz tarball shipping

---

## Enforcement Levels

| Level | Description | Action on Violation |
|-------|-------------|---------------------|
| **Block** | Hard stop, cannot proceed | Build/operation blocked until resolved |
| **Warn** | Advisory, requires acknowledgment | Warning logged, can proceed with justification |
| **Info** | FYI, best practice suggestion | Informational only, no blocking |

## Configuration

### .guardrails/prevention-rules/pattern-rules.json

Advisors are referenced in the PREVENT-* rules:

```json
{
  "rule_id": "PREVENT-ITH-004",
  "name": "Zero network calls at runtime",
  "severity": "critical",
  "advisor": "advisor-cost",
  "message": "Runtime network calls violate zero-network constraint"
}
```

## References

- [AGENT_GUARDRAILS.md](../AGENT_GUARDRAILS.md) — Core safety protocols
- [.guardrails/pre-work-check.md](../../.guardrails/pre-work-check.md) — Pre-work checklist
- [scripts/regression_check.py](../../scripts/regression_check.py) — Regression detection
