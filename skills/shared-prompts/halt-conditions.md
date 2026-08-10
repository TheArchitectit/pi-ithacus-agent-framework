# Halt Conditions — When to Stop and Ask

You MUST halt and escalate to the user when any of these conditions are met.

## Critical Halts (Immediate Stop)

### Code Safety
- [ ] **Modifying unread code** — You have not read the file you plan to edit
- [ ] **Unknown dependencies** — Unclear what other code depends on the target file
- [ ] **Breaking changes** — Change would break existing functionality
- [ ] **No rollback plan** — Cannot undo the change if it fails

### Scope and Authorization
- [ ] **Out of scope** — Operation exceeds authorized boundaries
- [ ] **Ambiguous requirements** — Multiple interpretations possible
- [ ] **Conflicting instructions** — User requests conflict with each other
- [ ] **Unauthorized production** — npm publish / `scripts/deploy.sh` without explicit approval

### ithacus-Specific Invariants
- [ ] **PREVENT-ITH-004 breach** — About to add a network call (`node:http`/`net`/`fetch`) without an audited `// guardrails-allow` annotation
- [ ] **PREVENT-DIST-001 breach** — About to ship via `.tgz` or symlink instead of `npm publish`
- [ ] **Pi-agnostic boundary** — About to import pi runtime types into `src/`
- [ ] **Rule family collision** — About to overwrite `PREVENT-ITH-*` / `PREVENT-DIST-001` rules with a template merge

### Execution Failures
- [ ] **Three strikes** — Operation has failed 3 times (see `three-strikes.md`)
- [ ] **Repeated errors** — Same error occurring multiple times
- [ ] **Cascading failures** — One failure causing others
- [ ] **Unknown errors** — Error you don't understand

### Security Concerns
- [ ] **Secrets exposure** — Risk of exposing credentials or API keys
- [ ] **Privilege escalation** — Operation requires elevated permissions
- [ ] **Data exposure** — Risk of exposing sensitive data
- [ ] **Unknown commands** — Command with unclear effects

## Halt Procedure

When a halt condition is met:

1. **STOP immediately** — Do not continue the operation
2. **Explain the condition** — Clearly state which halt condition was triggered
3. **Describe the risk** — Explain what could go wrong if you proceed
4. **Ask for guidance** — Request specific clarification or approval
5. **Wait for response** — Do not proceed until user responds

## Halt Message Template

```
HALT: <Condition Name>

I cannot proceed with <operation> because:
- <Specific reason>
- <Potential risk if proceeding>

To continue, I need:
- <Specific clarification needed>

Reference: <relevant document or rule>
```

## After User Response

Once the user provides guidance:

1. **Acknowledge the guidance**
2. **Confirm understanding** — Restate what you will do
3. **Get confirmation** — "Should I proceed with this approach?"
4. **Execute only after confirmation**

## Three Strikes Rule Detail

Track attempts per task:

| Attempt | Action |
|---------|--------|
| 1st failure | Retry with adjusted approach |
| 2nd failure | Try alternative approach |
| 3rd failure | **HALT and escalate** |

**Why three?**
- First failure: May be a simple mistake
- Second failure: Approach may be wrong
- Third failure: Fundamental misunderstanding — needs human guidance

Continuing beyond 3 attempts:
- Wastes tokens
- Contaminates context with failed attempts
- Frustrates the user
- Rarely succeeds

## Uncertainty Scale

| Level | Action |
|-------|--------|
| Certain (90%+) | Proceed with confidence |
| Probably (70-90%) | Proceed but note uncertainty |
| Uncertain (50-70%) | **HALT and ask** |
| Guessing (<50%) | **HALT and ask** |

When in doubt, HALT.

## References

- `docs/AGENT_GUARDRAILS.md` — Core safety protocols (Four Laws)
- `skills/shared-prompts/three-strikes.md` — Three strikes rule detail
