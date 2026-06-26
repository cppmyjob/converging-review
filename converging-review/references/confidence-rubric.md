# Confidence Rubric and 4-test Pre-filter

## Contents
- 4-test pre-filter (mandatory for every finding candidate)
- Confidence levels (HIGH / MED / LOW)
- Anti-overconfidence trigger
- Trans-round escalation guard
- Decoupled critique-revision pipeline

## 4-test pre-filter

A finding is a candidate for the plan only if it passes ALL FOUR tests below. The final bucket is determined by Confidence (see next section), not the count of passed tests.

### Test 1 — Bug-recurrence

Without the fix, the scenario from the plan's Context section cannot complete on happy path (deterministically blocked, OR ≥70% reproducibility per the user's deviation note). For non-code artefacts, "happy path" maps to the artefact's primary completion criterion (skill triggers correctly, prompt produces specified output, document section renders, etc.).

### Test 2 — No-new-abstractions

The fix is implementable in ≤20 units of change (see Artefact applicability table in the parent SKILL.md for unit definitions per artefact type). A new abstraction, service, endpoint, skill umbrella, prompt section, config system, cache, or circuit-breaker is **scope creep, NOT a blocker**.

### Test 3 — Not-discoverable-at-dev-time

The concern is a blocker only if discovery during implementation forces a re-plan (the approach is wrong, the step's intent collapses). Trivial fixes during implementation (renames, imports, typos) are NOT blockers. Absence of an artefact on which an entire step depends IS a blocker.

### Test 4 — Not-already-addressed

Re-read the plan's Changelog / v-sections. A concern already addressed in any prior version → NOT a finding. Reformulating an accepted fix → NOT a finding. Empty Changelog (round 1) → auto-pass.

### Fallbacks

- No "Context" section → Test 1 disabled, cr-completeness agent disabled (see edge-cases.md → Agent-read).
- Empty Changelog → Test 4 auto-passes.

## Confidence levels

Every finding gets HIGH / MED / LOW. Default is MED.

### HIGH

Awarded only when ALL of these hold:
- Exact citation of the artefact (file path + line number, section heading, API name, verbatim snippet — any verifiable identifier).
- A single dominant interpretation of the plan text.
- All four pre-filter tests pass without context guesses.

### MED

The finding is plausible but one of: ambiguous interpretation, missing exact citation, or one pre-filter test contested under reasonable counter-prior. Default when in doubt.

### LOW

Speculation ("what if…"), artefact "should be" without verbatim citation, contested by multiple pre-filter tests.

### Tie-break rules

- Doubt between HIGH and MED → MED.
- Pre-filter pass status determines candidacy, NOT confidence bucket.
- Confidence determines the bucket: HIGH → MUST-FIX, MED → SHOULD-DEFER (or CLARIFICATION when one test is contested), LOW → auto-reject.

## Anti-overconfidence trigger

If an agent has n≥4 findings AND ≥60% are HIGH, re-test every HIGH. Typical reviews produce 1-2 HIGH; 60%+ HIGH at n≥4 suggests the agent is over-flagging. Downgrade to MED only those that fail the second-pass 4-test re-check. Findings with verifiable artefact citations (Artefact-verifier outputs in particular) are protected from this downgrade.

## Trans-round escalation guard (orchestrator-side)

Defends against anti-Bayesian confidence drift in multi-round debate (LLMs tend to grow more confident across rounds even when given counter-evidence; see arXiv 2505.19184).

If the share of HIGH among MUST-FIX strictly increases for ≥2 consecutive rounds (e.g. 40% → 55% → 70%), auto-downgrade the weakest HIGH to MED. Weakest = least specific artefact citation; ties broken first-seen. Findings with exact verifiable artefact citations (file:line + snippet, real API name) are protected.

Round 1-2: guard disabled (a trend requires ≥3 rounds).

## Decoupled critique-revision pipeline (per finding)

After classification, each agent runs the following pipeline before emitting findings. This is a deterministic 4-step procedure executed in order.

### Step 1 — Cleanup

Run each finding through the auto-reject patterns (see auto-reject-patterns.md). Remove ONLY exact matches. Do NOT invent new rejection reasons.

### Step 2 — Classify

Bucket each survivor: MUST-FIX / SHOULD-DEFER / REQUIRES CLARIFICATION based on the 4-test pass/contestation pattern + Confidence + anti-overconfidence trigger. Doubt → CLARIFICATION, never silently delete.

### Step 3 — Revision (decoupled re-check)

For each HIGH, run the 4-test pre-filter a SECOND time with the OPPOSITE prior — ask "what if this finding is mistaken or scope creep dressed as a blocker?". If at least one test becomes contested under the opposite prior, downgrade to MED.

This step decouples generation (initial classification) from measurement (revised classification), reducing choice-supportive bias of the agent's own first-pass output (see arXiv 2404.09127 / CRITIC frameworks).

Findings with exact verifiable artefact citations (file:line + snippet) are protected from this downgrade.

### Step 4 — Sanity

Better to emit 2 HIGH-confidence findings than 5 MED/LOW. NO MUST-FIX is the expected outcome on a converging plan; do not manufacture findings to fill space.
