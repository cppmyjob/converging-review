# Converging Review

A tool for critically reviewing a plan **before** it is applied. It launches 4 independent, adversarial reviewers, each with a different "lens" on the plan, runs their findings through a strict filter, and iteratively drives the plan toward **full convergence** — the state where new review rounds stop finding real blockers.

## Why it's needed

Even after Claude Code's planning mode, a plan **can still contain errors** — and the more complex the plan, the more likely. In large multi-step plans the pieces stop fitting together: step 6 relies on an artefact that step 2 renamed; two decisions silently contradict each other; the "happy path" is spelled out, but the very first real scenario breaks it. Such defects aren't visible on a quick read, sail through `ExitPlanMode` — and only surface during implementation, where fixing them costs an order of magnitude more.

The core trap: **a model cannot reliably review its own plan**. The same blind spots that produced the defect prevent it from noticing it during self-review — the model tends to rubber-stamp its own plan. The remedy is several **independent** reviewers, each with its own adversarial optics, plus deterministic convergence tracking that keeps the review from spinning in place forever.

## Which agents are launched, and why

**4 subagents** are launched in parallel, each a separate role with a narrow mandate. The split is deliberate: one model in one role will always find less than four specialized perspectives that don't know about each other's findings.

| Agent | Role | What it looks for |
|---|---|---|
| 🧾 **Artefact Verifier** | Bureaucrat — literal reading, zero interpretation | Checks the plan's claims **against reality**: do the files, signatures, skill files, and tools the plan references actually exist (`file:line`). The only agent that goes beyond the plan's own text. |
| ⚖️ **Logic Contradictions** | Lawyer — hostile reading | **Direct contradictions** between steps that make a consistent implementation impossible. Not "ambiguity" — an actual conflict. |
| 🐞 **Completeness** | Debugger — step-by-step replay | Replays the original scenario from the "Context" section step by step and looks for **gaps that lead to a recurrence** of the original problem. |
| 📟 **Pre-mortem** | On-call operator — pager in week one | **Operational failure modes**: what breaks in the first week under normal user behaviour (requiring evidence, not speculation). |

**What this gives you:**

- **Independence kills self-review bias** — agents don't see each other's findings and don't "agree among themselves," so they catch what self-review misses.
- **Parallel lenses = broad coverage** — contradictions, non-existent artefacts, recurrences, and operational risks are caught simultaneously, not sequentially.
- **A strict filter against noise** — the 4-test pre-filter and confidence scoring cut out scope creep and "what if," leaving only real blockers (MUST-FIX). "0 MUST-FIX" is a normal, expected result on a good plan.
- **Convergence instead of an endless argument** — deterministic metrics (P-index, livelock, novelty-stall) recognize when a plan genuinely converges versus when the review is "treading water," and stop the loop in time.

## Rounds and convergence

The review is **iterative** — it runs in rounds, and that's where the name comes from. Each round produces a count of real blockers (MUST-FIX); you apply the fixes, then re-run the review. Round after round that count should **monotonically decrease** — e.g. `5 → 3 → 1 → 0`. Reaching **0 MUST-FIX** means the plan has converged and is ready for `ExitPlanMode`.

What happens each round depends on how many blockers were found:

- **1–3 MUST-FIX** → apply exactly those fixes and re-run the next round.
- **>3 MUST-FIX** → the plan is too complex / carries too many blockers to patch piecemeal → **replan and scope down to MVP**, so the blocker count drops on the next round instead of being papered over.
- **0 MUST-FIX** → converged, plan is ready.

And if the count *stops* falling — the same blockers keep coming back (**livelock**) or every round spawns a brand-new blocker at a new spot (**novelty-stall**) — the tool doesn't loop forever: it halts and asks you to reduce scope or change approach. Convergence is the goal, and the mechanics are built to guarantee the review either reaches it or tells you honestly that it can't.

## Not just plans

Although the tool is tuned for plans, it can review **any artefact that has an "intent" and an "implementation of that intent"**: a design document or spec, a prompt, another skill, a set of code changes (diff/PR), requirements. The methodology adapts its notions to the artefact type — what counts as an "artefact," how to "verify" it, and what the "unit of fix size" is (for code it's ~20 lines, for a prompt a paragraph, for a document a bullet). The type is determined from the first line of the "Context" section; on ambiguity the agent raises a CLARIFICATION.

## The cost

Yes, 4 parallel agents and several rounds cost **noticeably more tokens and time** than a single pass. But in my view, **getting the foundation right at the start pays for itself many times over**: a defect caught at the plan stage costs a paragraph of text, while the same defect surfacing in implementation costs hours of debugging, rework, and a cascade of related fixes. It's cheaper to spend tokens on a converging plan than to untangle the consequences of one that never fit together.

## How it differs from Dynamic Workflow

Conceptually it's close to **Dynamic Workflow** — it's also a fan-out across several agents — but it solves a different problem and, in my opinion, does it better for its case. Dynamic Workflow orchestrates the **execution** of work (decompose a task and do it in parallel). Converging Review doesn't do the work — it **adversarially reviews the plan before any work has started**, and adds what a plain fan-out lacks: fixed adversarial roles, a strict findings filter, and **cross-round convergence tracking** that drives the plan to a stable state rather than just collecting opinions in a single pass.

---

Its purpose is the preventive review of a plan/design/prompt **before** `ExitPlanMode`, not a post-mortem of changes already made.

The repository contains **two forms of the same tool**:

| Form | What it is | Who it's for |
|---|---|---|
| [`coverging-review.md`](coverging-review.md) | A single self-contained prompt document with the entire methodology | If you don't want to run scripts — just feed this file to the model |
| [`converging-review/`](converging-review/) | A full Claude Code skill: the same prompt + Node scripts + subagents | If you want deterministic mechanics (convergence metrics, round state, caps) |

**The skill was born from the md document** and does essentially the same thing. The only difference is execution: the document relies entirely on the model, while the skill offloads metric computation, round tracking, and cap enforcement to deterministic Node scripts. Anyone wary of running scripts can simply use `coverging-review.md`.

---

## `coverging-review.md` — the methodology in one file

A self-contained prompt: "launch 4 parallel Opus agents, each with its own mandate + shared rules." It contains everything needed for the review without any infrastructure:

- **4 agents** — Artefact Verifier (bureaucrat), Logic Contradictions (lawyer), Completeness (debugger), Pre-mortem (on-call operator).
- **4-test pre-filter** — Bug-recurrence / No-new-abstractions / Not-discoverable / Not-already-addressed: a finding counts as a blocker only if it passes all 4.
- **Confidence scoring** — HIGH → MUST-FIX, MED → SHOULD-DEFER, LOW → auto-reject. Guards against overconfidence and anti-Bayesian drift.
- **Auto-reject patterns** — scope creep, observability polish, paranoid what-if, "admin forgot X," multi-host fantasies.
- **Convergence tracking** — P-index, livelock, novelty-stall, trajectory label, computed from the plan's Changelog/v-sections.

The model reads the document itself, plays the roles, and computes the metrics "in its head."

---

## `converging-review/` — the same tool as a skill

The same prompt, but the mechanics are offloaded to deterministic helpers, and the agents run as full Claude Code subagents. The orchestrator works in 10 steps (see [`converging-review/SKILL.md`](converging-review/SKILL.md)):

1. Resolve plan → `canonicalHash` (invariant to Changelog mutation).
2. Load state — round history by hash.
3. Build context — per-agent context block.
4. Dispatch — 4 subagents **in parallel**.
5. Parse outputs — JSON marker / plain-text trailer.
6. Apply caps — MUST-FIX caps (AV=5, LC/CM/PM=3).
7. Compute metrics — convergence metrics.
8. Save state — atomic round write.
9. Render verdict — decision tree.
10. Present — findings tables + convergence tracking + verdict.

### Structure

```
converging-review/
├── SKILL.md                       # entry point: the orchestrator's 10 steps
├── examples.md                    # few-shot examples of correct/incorrect findings
├── config/
│   └── thresholds.json            # all numeric thresholds and limits
├── references/                    # reference docs included from SKILL.md
│   ├── confidence-rubric.md       # 4-test pre-filter + confidence levels
│   ├── auto-reject-patterns.md    # finding auto-rejection patterns
│   ├── output-format.md           # JSON marker schema + trailer + quarantine
│   └── edge-cases.md              # edge-case rulebook (agent + orchestrator)
└── scripts/                       # deterministic Node helpers (ESM, .mjs)
    ├── resolve-plan.mjs           # resolve plan source + hashes
    ├── state.mjs                  # read/write state (atomic)
    ├── inject-context.mjs         # build per-agent context block
    ├── parse-output.mjs           # parse agent output (JSON → trailer fallback)
    ├── caps.mjs                   # per-agent MUST-FIX caps
    ├── metrics.mjs                # convergence metrics
    └── verdict.mjs                # final verdict via the decision tree
```

Round state is stored by the plan's `canonicalHash` at `<cwd>/.claude/converging-review/state/<hash>.json` (fallback — `~/.claude/...`). Writes are atomic (`tmp` + `rename`) with a guard against concurrent sessions.

### Verdict (first match wins)

1. Livelock (round ≥ 3) → livelock-escape (ask the user).
2. Novelty-stall (round ≥ 5) → novelty-stall escape.
3. Cap-overflow ≥ 3 with in-bucket MUST-FIX = 0 → CLARIFICATION.
4. Round 1 with 0 MUST-FIX and no verified AV artefact → CLARIFICATION.
5. 0 MUST-FIX, all CLARIFICATION closed, no quarantine → **ready** (`ExitPlanMode`).
6. 1–3 MUST-FIX → apply those fixes and re-run the review.
7. >3 MUST-FIX → replan, scope down to MVP.

---

## How to use

The typical scenario is **right after drafting a plan, without leaving plan mode**.

### Option 1 — the skill (with mechanics and metrics)

Close the plan-mode questionnaire and invoke the skill command in the console:

```
/converging-review
```

With no arguments the skill picks up the active plan itself. You can also pass it explicitly: `/converging-review <plan-path>` or inline text.

### Option 2 — just the md document (no scripts)

If you don't want to run scripts — close the plan-mode questionnaire and type something like this in the console:

> Analyze your plan using `coverging-review.md` until full convergence is reached.

The model will read the document, run the plan through the 4 roles, and iterate rounds until the plan converges (0 MUST-FIX) or until a livelock/novelty-stall escape fires.

Both options do the same thing — choose based on whether you need the deterministic mechanics of the scripts or "review in the model's head" is enough.

---

## Compatibility

It was developed and tested on **Claude Code**. But there's nothing Claude-specific in the methodology itself — the core is just a prompt plus a fan-out of independent agents and a few deterministic helper scripts. So it should port to **other agentic systems** that support subagents/parallel fan-out and tool use (file read, search, web). The `coverging-review.md` form is the most portable: it's a plain prompt with no infrastructure, so you can feed it to almost any capable agent. The skill form relies on Claude Code's subagent dispatch and `.mjs` helpers, so porting it would mean adapting those two pieces to the target platform.

## When NOT to use it

- Plans <50 lines with single-step changes (overkill).
- After `ExitPlanMode` is already approved (the review is preventive, not retrospective).
- Pure refactor PRs with no plan artefact.
- Documents without a "what we're going to do" structure (specs, schemas, READMEs without steps).
