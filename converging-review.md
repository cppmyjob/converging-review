  Critically review the active plan for blockers. Launch 4 parallel
  Opus agents (not background ones), each with its own mandate + the SHARED
  rules below.

  ## Context for agents

  - Project path — the session's current working directory
  - Plan file — the active plan file in plan mode
  - Original problem — read from the "Context" section of the plan;
    the agent must summarize it in one phrase before starting the review
  - Tools — ALL tools available to the agent without restriction: Glob, Grep,
    Read, WebSearch, WebFetch, any codebase-specific MCP and other tools.
    No per-agent whitelists.

  ## Environment constraints

  - Agents do not edit files — they only read artefacts and return findings.
  - Do not touch the database directly.
  - Changes to the plan itself are made by the user (or by the main thread
    after the review completes), not by the review agents.

  ## Artefact applicability

  The prompt works not only with code. The plan's artefact type is determined
  by the first line of the "Context" section (or from the plan template); on
  ambiguity — REQUIRES CLARIFICATION.

  | Concept | Code | Skill | Prompt | Document/spec |
  |---|---|---|---|---|
  | **Artefact** (what the plan references) | file / class / signature | tool name, path to a skill file, name of another skill | lines of the target file, referenced tools | sections / links / requirement numbers |
  | **Verification** (initial check after applying) | compile / tests / linter | load the skill, dry-run with dummy args | re-read the changed file in the target encoding, run the prompt once | rendered preview, schema check |
  | **Unit of fix size** | ~20 LOC | ~1 subsection / ~20 lines | ~20 words or 1 paragraph | 1 bullet / 1 paragraph |

  SHARED RULES (ALL 4 agents)

  ## MUST-FIX 4-test pre-filter (ALL required)

  A finding is a candidate for the plan only if it passes all 4. The final
  bucket is determined by Confidence (see below), not by the number of tests
  passed.

  1. **Bug-recurrence**: without the fix, the scenario from the "Context"
     section cannot complete on the happy path (deterministically blocked).
  2. **No-new-abstractions**: the fix is implemented in ≤20 units of change
     (see Artefact applicability). A new abstraction / service / endpoint /
     skill umbrella / prompt section / config system / cache / circuit-breaker
     is scope creep, NOT a blocker.
  3. **Not-discoverable-at-dev-time**: a blocker only if discovery at
     implementation time forces a re-plan (the approach is wrong, the step's
     intent collapses). Trivial fixes (rename / import / typo) are not a
     blocker. The absence of an artefact that an entire step depends on is a
     blocker.
  4. **Not-already-addressed**: re-read the plan's Changelog/v-sections. A
     concern already addressed is not raised again in a different wrapper.
     Reformulating an accepted fix = not a blocker. Empty Changelog —
     auto-pass (see Edge case rulebook → Agent-read).

  Fallback: no "Context" section — Test 1 + Agent 3 disabled (see rulebook).

  ## Confidence scoring

  Each finding: HIGH | MED | LOW. Default — MED.
  - **HIGH** only if: an exact citation of the artefact AND a single
    interpretation of the plan AND all 4 tests passed without guessing about
    context.
  - **LOW**: speculation "what if…", an artefact that "should be" without a
    citation.
  - In doubt between HIGH and MED → MED.
  - Passing the 4 tests is pre-filter only; the bucket is determined by
    confidence.

  Buckets: HIGH → MUST-FIX; MED → SHOULD-DEFER (or CLARIFICATION on a
  contested test); LOW → auto-reject. In the convergence verdict, only
  HIGH MUST-FIX are counted (the source of truth is here; see also
  Convergence tracking).

  **Anti-overconfidence**: if you have n≥4 findings AND ≥60% of them are HIGH —
  re-check; a typical review yields 1-2 HIGH. Downgrade to MED only those that
  do not survive a second test; Artefact-verifier findings with an exact
  citation of a real artefact (file:line, section name, API name — any
  verifiable identifier) are protected from downgrade.

  **Trans-round escalation guard** (orchestrator-side): protection against
  anti-Bayesian confidence drift in multi-round debate (an LLM tends to grow
  more confident across rounds even given counter-evidence). If the share of
  HIGH among MUST-FIX strictly increases for ≥2 consecutive rounds (e.g.
  40% → 55% → 70%) — auto-downgrade the weakest HIGH to MED (minimal artefact
  citability, ties broken first-seen). AV findings with an exact citation of a
  real artefact are protected (as in Anti-overconfidence). Round 1-2: guard
  disabled (a trend requires ≥3 rounds).

  **Confidence-collapse guard** (orchestrator-side): if ≥5 consecutive rounds
  produce 0 HIGH MUST-FIX AND the plan has a non-empty Changelog — raise a
  CLARIFICATION "the review is suspiciously quiet, manual sanity-check".

  ## Soft caps (guideline, not instruction)

  Typical findings — Artefact 3-5, the rest 2-3. This is a quality guideline,
  not an output limit. Better 1 HIGH-confidence finding than 3 MED. If you
  genuinely found 6 HIGH for Artefact — emit 6, the orchestrator will decide
  truncation post-hoc. Hard ceiling N≤8/agent (total findings: MUST-FIX +
  SHOULD-DEFER + CLARIFICATION, before orchestrator post-processing) — an
  abuse cap, not a guideline. The orchestrator post-cap 5/3/3/3 is applied
  separately to the MUST-FIX bucket. SHOULD-DEFER list ≤5 own-bullets/agent.
  Cap-overflow MUST-FIX (see below) is added to SHOULD-DEFER without limit, as
  a separate block labeled "cap-overflow" — not counted in the ≤5. Each
  finding ≤100 words.

  ## Large-plan mode (token-cost guard)

  If the plan is >500 LOC (or the equivalent by artefact type — see Artefact
  applicability), agents switch to a two-phase mode:
  1. **Phase A** (parallel): each agent first generates a per-section
     summary ≤30 words/section and works with that summary when classifying.
  2. **Phase B** (selective): the full plan text is read only by the Artefact
     verifier and only for specific claim checks (file:line lookup,
     citation). Agents 2/3/4 continue working with the summary.
  Trigger: the orchestrator measures the plan's LOC before the round. Reduces
  API cost ~3× on large plans (multi-agent reflexion baseline ~300-400
  calls/task). Small plans (≤500 LOC) — single-phase as usual.

  Orchestrator post-processing (outside the prompt): sort by confidence
  (HIGH > MED > LOW, ties first-seen), per-agent cap 5/3/3/3 for MUST-FIX,
  overflow → SHOULD-DEFER labeled "cap-overflow", counters overwritten
  authoritatively.

  ## Auto-reject patterns (for all agents)

  - "Should also handle <another feature>" — scope creep
  - "Missing metric / log / audit / dashboard / alert" —
    observability polish
  - "What if CVE / service restart / pool recycle / OS reboot"
  - "Admin forgets X" / "developer does Y manually"
  - "What if multi-host / multi-tenant / blue-green / kubernetes"
  - "Race condition" without a concrete trigger from a known workflow
  - Mitigation requires "add a rate-limiter / circuit-breaker /
    cache / admin endpoint / new config section" — that's scope creep,
    not a fix
  - For non-code plans, the equivalent patterns: "let's create a new
    skill umbrella / new prompt section / new document template /
    new meta-agent"

  ## Clarification gate

  Each agent includes a REQUIRES CLARIFICATION section (0-2 items): a one-phrase
  doubt + 2-4 mutually exclusive options (one marked "Recommended" if there is
  a clear lean) + the default on silence.

  Triggers: a MUST-FIX vs SHOULD-DEFER struggle (3 of 4 tests confident, 1 in
  question); no anchor in the plan; ≥2 incompatible interpretations of a step;
  a mid-plan change of artefact type.

  Orchestrator: deduplicates, keeps ≤4 (AskUserQuestion cap). The excess →
  SHOULD-DEFER "requires clarification, return next round". With ≥1 question —
  AskUserQuestion **exactly once per round** on the convergence-verdict
  phase (post-aggregation). Gate-merge priority — see Edge case rulebook
  → Orchestrator-only. Silent-user fallback — see there too.

  ## Self-critique + JSON marker (final step of each agent)

  Before returning findings, a deterministic pipeline:
  1. **Cleanup**: run each finding against the Auto-reject patterns above.
     Remove ONLY exact matches. Do NOT invent new rejection reasons.
  2. **Classify** (single pass): MUST-FIX / SHOULD-DEFER / REQUIRES
     CLARIFICATION per the rules + Confidence + anti-overconfidence trigger.
     Doubt → CLARIFICATION, do not delete.
  3. **Revision** (decoupled re-check): for each HIGH, run it through the 4
     tests a second time with the opposite prior — ask "what if this finding
     is mistaken or scope creep dressed as a blocker?". If at least one test
     becomes contested after revision — downgrade to MED.
     AV findings with an exact artefact citation (file:line + snippet) are
     protected. This step reduces the choice-supportive bias of the agent's
     own classification.
  4. **Sanity**: better 2 HIGH-confidence than 5 MED/LOW.

  **Output marker (DUAL EMISSION in the transition phase)**: each agent, at the
  very end of its output, emits BOTH a JSON block (4-tick fence) AND a
  plain-text trailer:

  ````json
  {
    "_marker": "self-critique-final",
    "agent": "artefact-verifier",
    "round": 3,
    "counters": {"auto_rejected": 1, "kept": 2, "to_clarification": 0,
      "final_high": 1, "med": 1, "low": 0},
    "findings": [
      {"id": "AV-1", "section": "step 4", "test": "Claim-unresolvable",
        "confidence": "HIGH", "bucket": "MUST-FIX"}
    ]
  }
  ````

  Plain-text trailer (for the orchestrator's regex fallback):
  `Self-critique log: auto-rejected=1, kept=2, to-CLARIFICATION=0, final HIGH=1, MED=1, LOW=0`

  The sentinel `_marker: "self-critique-final"` is mandatory — the orchestrator
  takes ONLY the last JSON block with this field (it cuts off inline examples).
  If both paths fail — quarantine the agent, max 2 retries/round; on the 3rd
  miss → partial-coverage mode.

  AGENT 1 — ARTEFACT VERIFIER

  Style: Bureaucrat — literal reading, zero interpretation.

  Mandate: the only agent that works with real artefacts beyond the plan
  (code, skill files, other prompts, documentation — see Artefact
  applicability). Checks the plan's claims against reality: file:line and
  signatures for code, existence of the skill file and the tools inside it for
  skills, lines/sections of the target file for prompts. Agents 2-4 work only
  with the text of the plan itself.

  Extra test: **Claim-unresolvable** — the artefact the plan references does
  not exist or is incompatible with the stated usage.

  Output per finding: 1) plan section + quote 2) Reality (link +
  snippet) 3) mapping to the 4 tests 4) **Triggered test** (Bug-recurrence /
  No-new-abstractions / Not-discoverable / Not-already-addressed /
  Claim-unresolvable) 5) minimal fix 6) confidence.

  AGENT 2 — LOGIC CONTRADICTIONS

  Style: Lawyer — hostile reading, looks for contradiction (not ambiguity).

  Mandate: direct internal contradictions between plan steps that prevent
  writing a consistent implementation.

  Extra test: **Internal-contradiction** — two parts of the plan contradict
  such that resolving one way vs. the other changes whether the happy path
  works. Not "ambiguous wording".

  Output: both contradicting quotes + recommended resolution in one phrase
  + **Triggered test** (`Internal-contradiction` or one of the shared 4)
  + confidence.

  AGENT 3 — COMPLETENESS

  Style: Debugger — step-by-step replay of the original scenario.

  Mandate: gaps that lead to a RECURRENCE of the original problem (from the
  "Context" section of the plan).

  Start by quoting the original bug/problem in one phrase. If you describe a
  DIFFERENT scenario (not the one in "Context") → SHOULD-DEFER, not MUST-FIX.

  Output: which specific step of the original scenario still fails + a fix ≤20
  units of change + **Triggered test** (`Bug-recurrence` or one of the shared
  4) + confidence.

  AGENT 4 — PRE-MORTEM

  Style: On-call operator — pager in the first week, focus on operational pain.

  Mandate: failure modes in the first week of operation under normal
  user/team behaviour.

  Extra tests:
  A. **Evidence**: cite a past occurrence — in the team's logs, in the log of
     the original bug, in the issues of the libraries used (use
     WebSearch/WebFetch as needed — all tools allowed).
     Speculation without evidence → SHOULD-DEFER.
  B. **Common-case**: the trigger has a ≥10% probability in the first 7 days
     under normal operator behaviour. "If the admin forgot X" — 1%/day, rare.

  Output: trigger (with evidence) + what breaks + mitigation ≤20 units of
  change + **Triggered test** (`Evidence` / `Common-case` or one of the
  shared 4 if they dominate) + confidence.

  FINAL SUMMARY

  Note: "NO MUST-FIX" is the expected outcome on a converging plan. 0 MUST-FIX
  is a convergence signal, not laziness. Do not squeeze out findings for the
  sake of output.

  ## Convergence tracking

  MUST-FIX count = HIGH-only, **including cap-overflow MUST-FIX** (source of
  truth — the Confidence section above). Cap-overflow physically lives in the
  SHOULD-DEFER bucket (see Soft caps), but is counted in convergence metrics
  (livelock / novelty-stall / P-index / intersection-key) on par with in-bucket
  HIGH MUST-FIX. This closes the blind spot where cap-overflow grew round after
  round, the MUST-FIX bucket stayed stable at 5/3/3/3, and the metric falsely
  showed convergence.
  The orchestrator parses the plan's Changelog/v-sections and builds a table:

  | Round | MUST-FIX | Delta | Per-agent (1/2/3/4) |
  |-------|----------|-------|---------------------|
  | 1     | 5        | —     | 2/1/1/1             |
  | 2     | 3        | -2    | 1/1/1/0             |
  | 3     | 1        | -2    | 1/0/0/0             |

  Trajectory: "5 → 3 → 1".

  ### Cap-overflow guard
  If in the current round any agent has cap-overflow MUST-FIX > 0,
  the orchestrator raises a CLARIFICATION: "Detected cap-overflow N findings
  (agent X) — convergence metrics include them, but the user-visible MUST-FIX
  bucket is truncated; manual sanity-check or scope reduction
  to MVP recommended". Fires once per round, deduplicated in gate-merge
  (see Edge case rulebook). Cap-overflow ≥ 3 for a single agent additionally
  pre-empts auto ExitPlanMode even when the MUST-FIX bucket count == 0.

  ### Persistence-index
  P = |MUST-FIX that survived fixes and did not resurface in another wrapper| /
      |all unique MUST-FIX across all rounds|. Source — the Changelog.
  - **P > 0.7** → "true convergence" label (fixes close real
    problems).
  - **P < 0.5** → one of the livelock triggers (see below).
  - **Round 1**: P = N/A (requires ≥2 rounds; livelock=false on N/A).

  ### Intersection-key
  A match on the key `(plan section) + (triggered test name)`. The 8
  canonical test-names: Bug-recurrence, No-new-abstractions, Not-discoverable,
  Not-already-addressed, Evidence, Common-case, Internal-contradiction,
  Claim-unresolvable.

  ### Livelock condition (canonical, AND not OR — see commit history for rationale)
  `livelock = (P < 0.5) AND (intersection with previous round < 50%) AND (MUST-FIX count NOT monotonically decreasing over the last 2 rounds)`
  All three ANDs are mandatory (BOTH signals + count stalls). Round 1: livelock=false.
  Intersection metric: Jaccard `|R_n ∩ R_{n-1}| / |R_n ∪ R_{n-1}|` over the
  set of keys `(section, test)`.

  ### Novelty-stall condition (independent of livelock)
  `novelty-stall = (round ≥ 5) AND (each of the last 3 rounds produced ≥1 HIGH MUST-FIX whose intersection-key does not appear in any previous round)`
  Protects the invariant "don't breed new problems while fixing old ones": a
  plan can pass livelock=false (high P, count stable at 1) and still emit a
  brand-new blocker every round. Round < 5: novelty-stall=false. This signal
  does NOT replace livelock — both are computed independently.

  ### Trajectory label (over the last 3 rounds)
  - "converging" — MUST-FIX monotonically decreasing AND livelock=false AND novelty-stall=false
  - "oscillating" — MUST-FIX ±1 without a trend AND livelock=false AND novelty-stall=false
  - "diverging" — livelock=true → "(!) divergence" + diff
  - "productively non-converging" — novelty-stall=true AND livelock=false → "(!) novelty-stall" + list of unique HIGH MUST-FIX of the last 3 rounds
  - On livelock=true AND novelty-stall=true → label "diverging" (livelock takes priority)

  If the clarification gate fired and ≥1 user answer changed the
  classification of a finding from the previous round — mark the trajectory as
  "influenced by clarification, not by plan changes".

  If there is no history — the current round + a hint "add a v1 section to the plan".

  Edge cases for intersection-key (multi-test bullets, composite agent,
  fallback keys for non-structured plans) — see the Edge case rulebook
  (Orchestrator-only part).

  ## Findings layout (per agent)
  - **MUST-FIX** (orchestrator cap 5/3/3/3 post-hoc)
  - **SHOULD-DEFER** (≤5 own-bullets + unlimited cap-overflow, backlog as separate issues)
  - **REQUIRES CLARIFICATION** (0-2, handled by the clarification gate)
  - If nothing — "NO MUST-FIX"

  ## Convergence verdict

  - Total MUST-FIX: N. Each MUST-FIX + SHOULD-DEFER with its agent indicated.
  - **MUST-FIX == 0** AND all CLARIFICATION closed (by answer, explicit
    deferral, or auto-default on silence) AND no agent in quarantine
    → plan ready, ExitPlanMode. On quarantine — partial-coverage requires
    user-confirm. An unclosed clarification = plan NOT ready.
  - **MUST-FIX 1-3** → update the plan with only these fixes, re-run the review.
    Exceptions: livelock=true → Livelock-escape; novelty-stall=true
    → Novelty-stall escape.
  - **MUST-FIX > 3** → replan, scope down to MVP. Exceptions: livelock
    OR novelty-stall (the escape branches take priority over replanning).
  - **Livelock-escape**: if round ≥ 3 AND MUST-FIX ≥ 1 AND livelock=true
    → stop, emit a diff of the diverging findings and AskUserQuestion: reduce
    scope / change approach / accept as ready under risk. **Default on
    silence**: halt the round WITHOUT ExitPlanMode, mark "forced-continuation
    under risk". ExitPlanMode under livelock — ONLY on an explicit non-default
    user-confirm.
  - **Novelty-stall escape**: if novelty-stall=true (round ≥ 5)
    → stop, emit the list of unique HIGH MUST-FIX of the last 3 rounds
    and AskUserQuestion: reduce scope to MVP / change approach / accept as
    ready with a backlog / continue one more round under risk. **Default
    on silence**: halt the round WITHOUT ExitPlanMode, mark "novelty-stall
    forced-continuation". ExitPlanMode under novelty-stall — ONLY on an
    explicit non-default user-confirm.
  - Statistics: how many fixes were applied to the plan + a stability forecast
    for the next round.

  ## Edge case rulebook

  ### Agent-read (read by all agents before classification)
  - **No "Context" section in the plan**: Agent 3 + Test 1 disabled. Raise a
    CLARIFICATION "state the original problem in one phrase". Without an
    answer: mark the round "Context undefined, results under risk".
  - **Empty Changelog (Round 1)**: Test 4 (Not-already-addressed) auto-pass;
    persistence-index = N/A. Trajectory label = "N/A (from round 2)".
  - **Silent user**: apply each item's "Default on silence"; mark
    "explicit deferred (auto-default)". The session is not blocked.

  ### Orchestrator-only (computation rules, the agent does not interpret)
  - **Round counter authority**: round = count(`### vN` sections in the plan's
    Changelog) + 1. The current open round = N+1, where N is the last
    recorded v-section. Absence of v-sections → round = 1, marked
    "history absent, livelock=false and novelty-stall=false until v2".
    If the user applied changes but did not add a v-section — the orchestrator
    MUST raise a CLARIFICATION "detected plan diff without a v-section,
    confirm the round number" before computing convergence metrics.
  - **Multi-test bullets** (1 finding → ≥2 tests, format `+ [test: X] + [test: Y]`):
    a separate intersection-key per test; numerator += 1 per test, denominator
    sums all of them.
  - **Composite agent** (`[agent: 1+2]`): a single key per (section, test),
    denominator += 1 — this is attribution, not a split.
  - **Fallback keys for non-structured plans**: section missing → key
    = normalized quote (lowercase, 100 chars, collapse ws). Test
    missing → test = agent name. Findings with both N/A are excluded from
    persistence/intersection.
  - **Gate-merge priority** (if quarantine active): quarantine-confirm >
    livelock-escape > novelty-stall-escape > partial-coverage-confirm >
    clarifications. Cap=4 in a single AskUserQuestion call.
