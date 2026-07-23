# Reverse Prompt Validation (RPV)

> Status: Design — not yet implemented
> Priority: P1 (unique differentiator)
> Created: 2026-07-22

## 1. Concept

Reverse Prompt Validation flips the script: instead of the user prompting the agent blindly, the system validates the prompt FIRST and tells the user what's missing. The system prompts the USER.

Normal: user → prompt → agent executes → result (good or bad)
RPV: user → prompt → validator → feedback → user refines → agent executes → better result

## 2. Why This Is Different

No agent framework validates prompts before execution. pi-crew, pi-messenger, oh-my-pi all blindly execute whatever the user says. RPV catches problems before they waste tokens.

## 3. Four Validation Dimensions

### Clarity (0-100)
- Has verb+object structure (regex: /^(create|fix|refactor|add|remove|update|implement|design|write|test|debug|investigate|analyze|review|document)/i)
- Not a question (no ? or how/what/why/when without action)
- Length > 10 chars
- Contains specific nouns (not just 'this'/'that'/'it')

### Completeness (0-100)
- References files (.ts, .js, .py, .md, src/ etc.)
- Mentions tech (react, node, python, rust, typescript, etc.)
- Has constraints (must, should, ensure, without, etc.)
- Has output format (return, output, result, report, etc.)

### Safety (0-100)
- No destructive keywords without confirmation (delete, remove, drop, truncate, rm -rf, format)
- No secret patterns (password, api_key, token, secret, credential)
- No network keywords violating PREVENT-ITH-004 (fetch, http, url, api, request, curl)
- No guardrail violations (check against PREVENT-* rules)

### Scope (0-100)
- Token estimation based on prompt length + referenced file count
- Complexity heuristic: 'refactor' > 'fix', 'design' > 'implement'
- Team recommendation: if estimated tokens > 50K or complexity = high
- Model profile recommendation: simple tasks → Speed, complex → Reasoning

## 4. Validation Modes

- auto (default): warn if any score < 50, block if safety < 30
- strict: all scores must be > 70, returns structured feedback
- skip: bypass with --no-validate flag

## 5. ValidationReport Type

```typescript
interface ValidationReport {
  clarity: ScoredDimension;
  completeness: ScoredDimension;
  safety: ScoredDimension;
  scope: ScoredDimension;
  overall: number;
  verdict: 'pass' | 'warn' | 'block';
  feedback: string[];
  suggestedRefinements: string[];
  estimatedTokens: { input: number; output: number; };
  recommendedProfile: string;
  recommendedMode: ModePreset;
}
interface ScoredDimension {
  score: number;
  issues: string[];
  passed: string[];
}
```

## 6. Validation Feedback Format

```
⚠ Prompt Validation: 68/100 (WARN)

Clarity: 75/100 ✓
  ✓ Clear action verb: 'refactor'
  ✓ Target identified: 'auth module'
  ⚠ Success criteria not stated — add expected outcome

Completeness: 55/100 ⚠
  ✓ File path referenced: 'src/auth/'
  ⚠ Tech stack not mentioned — add framework/language
  ⚠ No constraints stated — add 'must not break existing tests'

Safety: 90/100 ✓
  ✓ No destructive actions
  ✓ No secret access
  ✓ No network calls

Scope: 50/100 ⚠
  ⚠ Large scope detected — consider splitting
  ⚠ Estimated cost: ~$0.30 (Reasoning profile recommended)
  Suggested mode: medium (3 agents)

Suggested refinements:
  + 'Using TypeScript and Express'
  + 'Must not break existing tests'
  + 'Expected: auth module split into 3 files'

Proceed anyway? [Y/n/s(how refined prompt)]
```

## 7. The Reverse Interaction

When score < 50, the system reverse-prompts the user:

```
Your prompt scored 45/100. Here's what's missing:

1. No file paths specified. Which files should be modified?
   → Add: 'in src/auth/login.ts and src/auth/middleware.ts'

2. No success criteria. How will you know when it's done?
   → Add: 'The auth module should pass all existing tests and support OAuth2'

3. Scope too large for a single agent. Break into phases?
   → Suggested: Phase 1 (analysis) → Phase 2 (implementation) → Phase 3 (tests)

Refine your prompt and try again, or proceed with --no-validate.
```

## 8. Implementation: src/validator.ts

Rules-based engine (~200 lines). Pure regex/string analysis. No LLM calls. No network. <10ms.

Core function: `validatePrompt(prompt: string, context?: ValidationContext): ValidationReport`

Each dimension is scored independently, then weighted: safety (40%), clarity (25%), completeness (20%), scope (15%).

## 9. Integration Points

1. Before createTeam in extensions/ithacus-team.ts
2. Before single agent runs
3. During /ithacus-team profile selection (show validation with profile recommendation)
4. Dashboard validation history

## 10. Integration with Model Profiles

Validation recommends the appropriate model profile:
- Simple tasks (scope score > 80) → Speed profile
- Standard tasks (scope score 50-80) → Quality profile
- Complex tasks (scope score < 50) → Reasoning profile
- Code-specific (detected by keywords) → Code profile

## 11. Integration with Team Mode

Validation recommends team size:
- Trivial (scope > 90) → single agent, no team
- Simple (scope 70-90) → tiny (1 agent)
- Medium (scope 40-70) → medium (3 agents)
- Complex (scope < 40) → large+ (4+ agents)

## 12. Configuration in IthacusConfig

```typescript
validationMode: 'auto' | 'strict' | 'skip'
validationThresholds: { clarity: 50, completeness: 50, safety: 70, scope: 50 }
validationBlockThreshold: 30  // safety below this = hard block
```

## 13. Performance

- <10ms (pure regex/string, no LLM)
- Zero network calls (PREVENT-ITH-004 compliant)
- Zero token cost
- Can run on every prompt without friction

## 14. Files to Create/Modify

- src/validator.ts — NEW: rules-based validation engine
- src/types.ts — ADD: ValidationReport, ScoredDimension
- src/config.ts — ADD: validation config fields
- extensions/ithacus-commands.ts — MODIFY: validate before createTeam, show feedback
- extensions/ithacus-team.ts — MODIFY: validate before dispatch
- extensions/ithacus.ts — MODIFY: wire validation config

## 15. Safety Hard-Block Rules

These always block regardless of mode:
- Prompt contains API keys or secrets patterns
- Prompt requests rm -rf / or equivalent
- Prompt violates active PREVENT-* rules
- Safety score < validationBlockThreshold (default 30)

## 16. What Makes This Different (Summary)

1. No agent framework validates prompts before execution
2. The system tells the USER what's missing
3. Zero-cost (rules-based, not LLM)
4. Recommends model profile based on complexity
5. Recommends team size based on scope
6. Safety gate catches guardrail violations before they happen
7. Scope estimation prevents runaway token spend
