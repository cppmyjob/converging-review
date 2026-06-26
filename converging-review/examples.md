# Examples

## Contents
- Example 1: Correct AV finding (HIGH MUST-FIX with verifiable artefact)
- Example 2: Correct REQUIRES CLARIFICATION (Lawyer borderline 3-of-4 tests)
- Example 3: Auto-rejected scope creep
- Example 4: Cap-overflow round (AV produces 7 HIGHs)
- Example 5: Novelty-stall escape (round 5 with 3 fresh-locus HIGHs)

---

## Example 1 — Correct AV finding (HIGH MUST-FIX)

```
### AV-1 — Step 4 fallback path is architecturally non-functional

1) Plan section + quote (SKILL.md lines 156-163, Step 4 dispatch fallback):
   "If subagent_type for custom agents is not accepted on this Claude Code
    version, fall back to using the agent files via @-mentions inside a
    generic general-purpose Agent call: Agent(subagent_type: "general-purpose",
    prompt: "@cr-artefact-verifier — <context block>")"

2) Reality (Claude Code subagent docs, code.claude.com/docs/en/sub-agents):
   - "Subagents cannot spawn other subagents. If your workflow requires
     nested delegation, use Skills or chain subagents from the main
     conversation." (line 715 of fetched doc)
   - "@agent-<name> for local subagents" (correct mention syntax, line 618)

3) 4-test mapping:
   - Bug-recurrence: PASS (when subagent_type rejected, fallback fails silently → no review fires)
   - No-new-abstractions: PASS (replace with hard-error, ≤20 LOC)
   - Not-discoverable: PASS (only at runtime when fallback fires)
   - Not-already-addressed: PASS (introduced this round)

4) Triggered test: Claim-unresolvable (artefact does not exist as described)

5) Minimal fix: Replace fallback (lines 158-163) with hard-error message
   instructing user to relaunch session with subagents auto-discovered
   from ~/.claude/agents/.

6) Confidence: HIGH (exact docs citations + verbatim plan quote + single
   interpretation; protected from downgrade by AV-citation rule).
```

Why this is HIGH and not MED:
- Two independent doc citations (line 715 + line 618) provide verifiable artefact reality.
- Plan quote is verbatim with file:line reference.
- All 4 tests pass without context guesses.
- Decoupled revision (opposite-prior re-check) cannot dismiss it as scope creep — the fallback IS the documented escape route, and its non-functionality is provable.

---

## Example 2 — Correct REQUIRES CLARIFICATION

```
### CL-1 — CLI flag spelling: --agent vs --agents

Sub-section: lines 14, 177, 601 of plan.

Doubt (one phrase): The plan uses --agent (singular, lines 14 and 601) for
unit-testing a single subagent and --agents (plural, line 177) inside the
hard-error message — but if the actual Claude Code CLI flag has only one
spelling, one of the call-sites is wrong.

Options (≤4, one marked Recommended):
1. Both forms exist as documented Claude Code CLI flags (--agent for single
   one-shot, --agents for multi-injection JSON). Lawyer accepts; no fix
   needed. (Recommended pending AV verification)
2. Only --agents exists — fix lines 14 and 601 to plural.
3. Only --agent exists — fix line 177 to singular and adjust path expansion.
4. Different real flag names entirely (e.g. --agents-dir).

Default at silence: option 1 (assume both spellings real, defer concrete
verification to Agent 1 / Artefact Verifier).
```

Why CLARIFICATION and not MUST-FIX or SHOULD-DEFER:
- Lawyer scope is internal contradictions, not flag verification (that's AV).
- 3 of 4 tests pass uncertainly; 1 test (artefact verification) is outside Lawyer's mandate.
- Cap: ≤2 CLARIFICATION items per agent; orchestrator deduplicates and limits to 4 total in AskUserQuestion.

---

## Example 3 — Auto-rejected scope creep

Candidate finding (BEFORE Cleanup pass):
> "Plan should also handle the case where the user reviews multiple plans
>  in parallel (multi-plan dashboard mode)."

Cleanup pass: matches "Should also handle <other feature>" auto-reject pattern.
Action: REMOVE during Cleanup. Do NOT bucket as SHOULD-DEFER.

Why auto-reject and not SHOULD-DEFER:
- Multi-plan dashboard is OUT OF SCOPE for this plan (plan is for a single-plan reviewer).
- Adding it would require a new abstraction layer (dashboard / aggregator), violating Test 2 (No-new-abstractions).
- Auto-reject patterns exist precisely to prevent SHOULD-DEFER bucket from filling with scope creep.

---

## Example 4 — Cap-overflow round

Round 5 outputs (hypothetical):

```
AV (Bureaucrat): 7 HIGH MUST-FIX findings
LC (Lawyer): 1 HIGH MUST-FIX
CM (Debugger): 0 HIGH
PM (On-call): 0 HIGH
```

Orchestrator post-processing applies caps (AV cap = 5):

- mustFix = [AV-1, AV-2, AV-3, AV-4, AV-5, LC-1] (6 items in MUST-FIX bucket)
- shouldDefer = [AV-6 (capOverflow=true, originalBucket=MUST-FIX), AV-7 (capOverflow=true)]
- capOverflowAgents = [{ agent: "av", count: 2 }]

Cap-overflow guard fires (count > 0 for AV):
- Orchestrator raises CLARIFICATION: "Detected cap-overflow 2 findings (agent av) — convergence metrics include them but the user-visible MUST-FIX bucket is truncated; manual sanity-check or scope reduction to MVP recommended."
- Convergence metrics (P-index, Jaccard) STILL count AV-6 and AV-7 (cap-overflow doesn't hide work from the trajectory tracker).

If AV cap-overflow ≥ 3 AND in-bucket MUST-FIX = 0, orchestrator pre-empts auto-ExitPlanMode (the apparent zero-MUST-FIX is fake, hidden by truncation).

---

## Example 5 — Novelty-stall escape

Round 5 of a plan that has been "fixed" 4 times. Trajectory:

| Round | HIGH MUST-FIX | Locus | Intersection-key seen before? |
|---|---|---|---|
| 1 | 1 | (Step 1, Bug-recurrence) | — |
| 2 | 1 | (Step 3, Internal-contradiction) | NO |
| 3 | 1 | (Step 5, Evidence) | NO |
| 4 | 1 | (Step 2, Common-case) | NO |
| 5 | 1 | (Step 7, Claim-unresolvable) | NO |

Orchestrator's metrics.mjs computes:
- Round ≥ 5: ✓
- Last 3 rounds (3, 4, 5) each produced ≥1 HIGH MUST-FIX: ✓
- Each of those HIGHs has intersection-key NOT seen in any prior round: ✓
- Result: noveltyStall = TRUE.

Verdict: novelty-stall escape branch fires.
- Decision: novelty-stall-escape
- Message: "Novelty-stall detected (3 consecutive rounds with fresh-locus HIGH MUST-FIX)."
- AskUserQuestion options: scope-reduce-to-MVP / change-approach / accept-with-backlog / continue-one-more-round-at-risk
- Default at silence: halt-no-exit-marked-novelty-stall-forced-continuation

This catches plans that are "productive" (each round closes the previous bug) but never actually converge — every fix introduces a fresh bug at a new locus. The plan is producing motion without progress; user must decide whether to scope down or accept the backlog.
