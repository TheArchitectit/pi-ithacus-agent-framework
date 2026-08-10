# The Four Laws of Agent Safety

These four laws are MANDATORY and NON-NEGOTIABLE for all AI agent operations on
the ithacus codebase. They are the operational form of the project's
`docs/AGENT_GUARDRAILS.md` safety protocols.

## Law 1: Read Before Editing

**NEVER modify code without reading it first.**

### Requirements
- Use the `read` tool to view file contents before any edit
- Understand the full context of the code
- Identify dependencies and side effects
- Do not rely on assumptions about file contents

### Violation Consequences
- Breaking working code
- Introducing subtle bugs
- Missing critical context
- Violating user trust

### Enforcement
- All skills and hooks must verify reads occurred
- Operations on unread files are blocked
- User confirmation required if read status uncertain

---

## Law 2: Stay in Scope

**Only touch files explicitly authorized.**

### Requirements
- Work only on files within the authorized scope
- Do not modify "nearby" or "related" code without permission
- No feature creep or "while I'm here" changes
- Each change must be traceable to a user request

### Scope Determination
- Explicit file list from user
- Files identified in task description
- Files discovered through dependency analysis (with approval)

### Violation Consequences
- Unintended side effects
- Difficult code reviews
- Breaking unrelated functionality
- Scope creep

---

## Law 3: Verify Before Committing

**Test and check all changes.**

### Requirements
- Run `npm run gate` before committing (build + lint + guardrails + semantic + schema-health + regression + smoke)
- Verify changes achieve the intended goal
- Check for lint/formatting errors
- Review diff for unintended changes

### Verification Checklist
- [ ] `npm run gate` passes (smoke-src + smoke-ext green)
- [ ] `tsc` compiles with no new errors
- [ ] No unintended files modified
- [ ] Changes match the task description
- [ ] No secrets or credentials exposed
- [ ] PREVENT-ITH-004 stays green (zero network at runtime; audited exceptions annotated)

### Violation Consequences
- Broken builds
- Failed deployments
- Rollbacks required
- Production incidents

---

## Law 4: Halt When Uncertain

**Ask for clarification instead of guessing.**

### Requirements
- When uncertain, STOP and ask the user
- Do not make assumptions about intent
- Clarify ambiguous requirements
- Confirm when multiple valid approaches exist

### Uncertainty Indicators
- "I think..." or "Probably..." in reasoning
- Multiple possible interpretations of requirements
- Unfamiliar patterns or technologies
- Potential security or safety concerns
- Conflicting constraints

### Halt Conditions
- Modifying unread code
- Unclear scope boundaries
- Missing rollback procedure
- Three failed attempts at a task (see `three-strikes.md`)
- Any safety concern

### Violation Consequences
- Wrong implementations
- Wasted effort
- User frustration
- Potential system damage

---

## Universal Application

These laws apply to ALL operations:
- File modifications (`src/`, `extensions/`, `docs/`, `.guardrails/`)
- Git operations (commits, tags, pushes)
- Command execution (`bash`, `npm run gate`, `python3 scripts/...`)
- Configuration changes (`package.json`, `openclaw.plugin.json`, `tsconfig.json`)
- Documentation updates

## Reference

Full documentation: `docs/AGENT_GUARDRAILS.md`
