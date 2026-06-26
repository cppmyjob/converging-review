#!/usr/bin/env node
// Render final convergence verdict given state + metrics.
// Usage: node verdict.mjs <canonicalHash>
// Outputs JSON: { decision, message, requiresUserChoice, options?, defaultOnSilence?, mustFixSummary }

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const thresholds = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'thresholds.json'), 'utf-8'));

const hash = process.argv[2];
if (!hash) {
  process.stderr.write('verdict.mjs: usage: verdict.mjs <canonicalHash>\n');
  process.exit(2);
}

function loadState(h) {
  const candidates = [
    join(process.cwd(), '.claude', 'converging-review', 'state', `${h}.json`),
    join(homedir(), '.claude', 'converging-review', 'state', `${h}.json`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  }
  return null;
}

const state = loadState(hash);
if (!state || !Array.isArray(state.rounds) || state.rounds.length === 0) {
  process.stdout.write(JSON.stringify({
    decision: 'unknown',
    message: 'No state for this plan; cannot render verdict',
    requiresUserChoice: false,
    mustFixSummary: { count: 0, perAgent: {}, items: [] },
  }) + '\n');
  process.exit(0);
}

// Compute metrics inline (avoid spawning metrics.mjs subprocess; share logic).
const metrics = JSON.parse(execSync(`node "${join(__dirname, 'metrics.mjs')}" ${hash}`, { encoding: 'utf-8' }));

const lastRound = state.rounds[state.rounds.length - 1];
const findings = lastRound.findings || [];

const mustFixItems = findings.filter(f =>
  (f.confidence || '').toUpperCase() === 'HIGH' &&
  ((f.bucket || '').toUpperCase() === 'MUST-FIX' ||
   (f.isCapOverflow && (f.originalBucket || '').toUpperCase() === 'MUST-FIX'))
);
const mustFixCount = mustFixItems.length;
const perAgent = mustFixItems.reduce((acc, f) => {
  acc[f.agent] = (acc[f.agent] || 0) + 1;
  return acc;
}, {});

const round = metrics.round;
const hasOpenClarifications = (lastRound.openClarifications || 0) > 0;
const hasQuarantine = (lastRound.quarantineAgents || []).length > 0;

// Cap-overflow guard: if any agent has cap-overflow ≥ 3 AND in-bucket MUST-FIX = 0,
// pre-empt auto-ExitPlanMode.
const inBucketMustFix = findings.filter(f =>
  (f.confidence || '').toUpperCase() === 'HIGH' &&
  (f.bucket || '').toUpperCase() === 'MUST-FIX' &&
  !f.isCapOverflow
).length;
const capOverflowByAgent = findings.reduce((acc, f) => {
  if (f.isCapOverflow && (f.originalBucket || '').toUpperCase() === 'MUST-FIX') {
    acc[f.agent] = (acc[f.agent] || 0) + 1;
  }
  return acc;
}, {});
const capOverflowSpike = Object.values(capOverflowByAgent).some(c => c >= thresholds.capOverflowMustFixThreshold);

// Decision tree (top-to-bottom, first match wins per plan spec).
let decision, message, requiresUserChoice = false, options = null, defaultOnSilence = null;

if (metrics.livelock && round >= 3 && mustFixCount >= 1) {
  decision = 'livelock-escape';
  message = 'Livelock detected (P<0.5 AND Jaccard<0.5 AND count not decreasing for 2+ rounds).';
  requiresUserChoice = true;
  options = ['scope-reduce-to-MVP', 'change-approach', 'accept-with-risk'];
  defaultOnSilence = 'halt-no-exit-marked-forced-continuation';
} else if (metrics.noveltyStall && round >= thresholds.noveltyStallMinRound) {
  decision = 'novelty-stall-escape';
  message = `Novelty-stall detected (${thresholds.noveltyStallWindow} consecutive rounds with fresh-locus HIGH MUST-FIX).`;
  requiresUserChoice = true;
  options = ['scope-reduce-to-MVP', 'change-approach', 'accept-with-backlog', 'continue-one-more-round-at-risk'];
  defaultOnSilence = 'halt-no-exit-marked-novelty-stall-forced-continuation';
} else if (capOverflowSpike && inBucketMustFix === 0) {
  decision = 'cap-overflow-clarification';
  message = `Cap-overflow ≥ ${thresholds.capOverflowMustFixThreshold} detected for at least one agent while in-bucket MUST-FIX = 0; apparent ready-state may be hiding work.`;
  requiresUserChoice = true;
  options = ['manual-sanity-check', 'scope-reduce-to-MVP', 'proceed-anyway'];
  defaultOnSilence = 'manual-sanity-check';
} else if (round === 1 && mustFixCount === 0) {
  // Round-1 fallback (LC-1 fix from v1): require ≥1 verified-artefact AV finding OR explicit user-confirm.
  const avVerified = findings.some(f =>
    f.agent === 'av' &&
    (f.confidence || '').toUpperCase() === 'HIGH' &&
    f.section && f.section.includes(':')
  );
  if (!avVerified && !lastRound.userConfirmedTrivial) {
    decision = 'round-1-clarification';
    message = 'Round 1 with 0 MUST-FIX requires either ≥1 AV finding with verifiable artefact OR user-confirm "plan is trivial" before allowing ready-state.';
    requiresUserChoice = true;
    options = ['confirm-plan-is-trivial', 'request-deeper-AV-pass'];
    defaultOnSilence = 'hold-and-confirm';
  } else {
    decision = 'ready';
    message = 'Round 1 ready: 0 MUST-FIX with verifiable artefact citation.';
  }
} else if (mustFixCount === 0 && !hasOpenClarifications && !hasQuarantine) {
  decision = 'ready';
  message = `Plan ready (round ${round}): 0 MUST-FIX, all CLARIFICATION closed, no agent in quarantine.`;
} else if (mustFixCount >= 1 && mustFixCount <= 3) {
  decision = 'apply-fixes';
  message = `Apply ${mustFixCount} MUST-FIX item(s), then re-run /converging-review for the next round.`;
} else if (mustFixCount > 3) {
  decision = 'replan';
  message = `${mustFixCount} MUST-FIX items > 3 — recommend replan / scope reduction to MVP.`;
}

if (metrics.confidenceCollapse) {
  message += ' [Note: confidence-collapse triggered — review suspiciously quiet for ≥3 rounds; manual sanity-check recommended.]';
}
if (metrics.transRoundEscalation) {
  message += ' [Note: trans-round escalation triggered — %HIGH strictly increasing; weakest HIGH auto-downgraded.]';
}
if (metrics.antiOverconfidenceWarning) {
  message += ' [Note: anti-overconfidence triggered — n≥4 findings with ≥60% HIGH; second-pass re-test required.]';
}

process.stdout.write(JSON.stringify({
  decision,
  message,
  requiresUserChoice,
  options,
  defaultOnSilence,
  trajectoryLabel: metrics.trajectoryLabel,
  metrics,
  mustFixSummary: {
    count: mustFixCount,
    perAgent,
    items: mustFixItems.map(f => ({
      id: f.id,
      agent: f.agent,
      section: f.section,
      test: f.test,
      isCapOverflow: f.isCapOverflow || false,
    })),
  },
}) + '\n');
