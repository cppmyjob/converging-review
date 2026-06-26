# Output Format Specification

## Contents
- Per-finding format
- JSON marker block schema
- Plain-text trailer (regex fallback)
- Quarantine policy
- DUAL EMISSION rationale

## Per-finding format

Each finding in MUST-FIX / SHOULD-DEFER / REQUIRES CLARIFICATION buckets contains the fields below. Different agents emphasise different fields per their mandate, but all fields are common.

| Field | Purpose | Example |
|---|---|---|
| 1) Plan section + quote | Identify exact location | "SKILL.md Step 1, line 87: `node ${CLAUDE_SKILL_DIR}/scripts/resolve-plan.mjs`" |
| 2) Reality (link + snippet) | What the artefact actually says (AV only) | Doc URL + verbatim snippet |
| 3) 4-test mapping | Pass/fail per test | Test 1 PASS, Test 2 PASS, Test 3 PASS, Test 4 PASS |
| 4) Triggered test | Primary triggering test name | "Claim-unresolvable" / "Internal-contradiction" / "Bug-recurrence" / "Evidence" / "Common-case" / one of the general 4 |
| 5) Minimal fix | Localised correction ≤20 units | "Replace line 87 with `--from-file` flag invocation" |
| 6) Confidence | HIGH / MED / LOW | HIGH |

Each finding ≤100 words.

## JSON marker block schema

Every agent ends its output with a JSON block fenced with FOUR backticks (the methodology's chosen fence — distinguishes from inline three-backtick code examples). The block contains a sentinel field `_marker: "self-critique-final"` that the orchestrator parser uses to identify it.

````json
{
  "_marker": "self-critique-final",
  "agent": "artefact-verifier" | "logic-contradictions" | "completeness" | "pre-mortem",
  "round": 3,
  "counters": {
    "auto_rejected": 1,
    "kept": 2,
    "to_clarification": 0,
    "final_high": 1,
    "med": 1,
    "low": 0
  },
  "findings": [
    {
      "id": "AV-1",
      "section": "step 4",
      "test": "Claim-unresolvable",
      "confidence": "HIGH",
      "bucket": "MUST-FIX",
      "isCapOverflow": false
    }
  ]
}
````

## Plain-text trailer (regex fallback)

Immediately after the JSON block (or in place of it if the agent fails to emit JSON), every agent emits a single-line plain-text counter summary that the orchestrator can parse via regex if JSON parsing fails.

Format:
```
Self-critique log: auto-rejected=N, kept=M, to-CLARIFICATION=K, final HIGH=H, MED=L, LOW=W
```

Regex (orchestrator parse-output.mjs fallback):
```
/Self-critique log:\s*auto-rejected=(\d+),\s*kept=(\d+),\s*to-CLARIFICATION=(\d+),\s*final HIGH=(\d+),\s*MED=(\d+),\s*LOW=(\d+)/
```

## DUAL EMISSION rationale

Both JSON marker and plain-text trailer are emitted per round. Belt-and-suspenders against:
- LLM forgetting code-fence syntax (4-tick fence is unusual; LLM may emit 3-tick).
- LLM emitting trailing commentary after the JSON block, breaking JSON.parse on the orchestrator side.
- LLM truncating output mid-JSON.

The orchestrator parser tries JSON first (last block matching `_marker: "self-critique-final"` to skip inline examples), then regex on the plain-text trailer if JSON fails. Only if BOTH fail does the agent slot enter quarantine.

## Quarantine policy

If an agent's output cannot be parsed via either JSON marker or plain-text trailer:
- Re-dispatch the same agent up to 2 times (3 total attempts including the initial). Matches methodology spec line 189.
- API errors (429, overload, network, timeout) consume the same retry budget.
- Mixed parse-failure + API-error counts cumulatively (a budget-of-2 means at most 2 re-dispatches regardless of error type).

After exhausting retries, the agent slot enters partial-coverage mode:
- The orchestrator surfaces the quarantined slot in the convergence verdict.
- ExitPlanMode under partial-coverage requires explicit user-confirm (cannot auto-approve).
- The partial-coverage state persists for the round but does NOT mark the agent as permanently unavailable — next round attempts a fresh dispatch.
