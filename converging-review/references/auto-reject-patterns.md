# Auto-reject Patterns

Findings matching these patterns are rejected during the Cleanup step of the self-critique pipeline. Match exactly — do NOT invent new rejection reasons.

## Scope creep

- "Should also handle <other feature>" — outside the plan's stated scope.
- "Should also support <additional case>" when the case is not in the original Context.
- Mitigation requires "add rate-limiter / circuit-breaker / cache / admin endpoint / new config section" — that's a new abstraction, not a fix.
- "Refactor X while we're here" — orthogonal to the bug.

## Observability polish

- "Missing metric / log / audit / dashboard / alert" — not a blocker, observability gap.
- "No telemetry on this code path" — same category.
- "No documentation of this corner case" — doc polish, not a defect.

## Paranoid what-if

- "What if CVE / service restart / pool recycle / OS reboot / power loss"
- "What if the database goes down mid-write" without a concrete reproduction.
- "What if Claude Code itself has a bug we don't know about" — platform speculation.

## Admin-forgets / human error

- "Admin forgets X" / "developer does Y manually" — sub-1%/day events.
- "User accidentally deletes the config file" — not a fix the plan owes.
- "Someone might paste the wrong value" — process issue, not implementation.

## Multi-host fantasy

- "What if multi-host / multi-tenant / blue-green / kubernetes / load balancer" — these contexts aren't in the plan's scope unless explicitly mentioned.
- "Geographic replication concerns" — out of scope for a personal-skill artefact.

## Race conditions without trigger

- "Race condition" without a CONCRETE triggering workflow that's documented in the plan or the user's known usage.
- "Concurrency issues might arise" — speculation.
- Concurrency findings require: a specific sequence of operations + a specific actor that performs them in that sequence.

## Mitigation = new abstraction

- Mitigation requires "introduce a new service / new endpoint / new database table / new daemon / new background job" — that's scope creep dressed as a fix.
- Acceptable mitigation: localised correction within ≤20 units of change, no new top-level abstractions.

## Non-code artefact equivalents

For skill / prompt / document plans, equivalent reject patterns:
- "Create a new skill umbrella" / "new meta-agent" / "new section in the prompt"
- "New template format for this corner case"
- "New review tier on top of existing reviews"

## Already-addressed concerns

Per Test 4 (Not-already-addressed), concerns already addressed in any prior v-section of the Changelog → reject. Reformulation of an accepted fix in different wording → reject.
