#!/usr/bin/env node
// Compute convergence metrics for the current round given the state file.
// Usage: node metrics.mjs <canonicalHash>
// Outputs JSON: { mustFixCount, jaccard, pIndex, livelock, noveltyStall, transRoundEscalation,
//                 confidenceCollapse, trajectoryLabel, antiOverconfidenceWarning }

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const thresholds = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'thresholds.json'), 'utf-8'));

const hash = process.argv[2];
if (!hash) {
  process.stderr.write('metrics.mjs: usage: metrics.mjs <canonicalHash>\n');
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
  // Round 1 — no history.
  process.stdout.write(JSON.stringify({
    mustFixCount: 0,
    jaccard: null,
    pIndex: null,
    livelock: false,
    noveltyStall: false,
    transRoundEscalation: false,
    confidenceCollapse: false,
    trajectoryLabel: 'N/A (history absent until round 2)',
    antiOverconfidenceWarning: false,
    round: 1,
  }) + '\n');
  process.exit(0);
}

const rounds = state.rounds;
const lastRound = rounds[rounds.length - 1];
const prevRound = rounds.length >= 2 ? rounds[rounds.length - 2] : null;

// HIGH MUST-FIX count includes cap-overflow items per spec.
function highMustFixCount(round) {
  if (!round.findings) return round.mustFixCount ?? 0;
  return round.findings.filter(f =>
    (f.confidence || '').toUpperCase() === 'HIGH' &&
    ((f.bucket || '').toUpperCase() === 'MUST-FIX' ||
     (f.isCapOverflow && (f.originalBucket || '').toUpperCase() === 'MUST-FIX'))
  ).length;
}

function findingKey(f) {
  return `${(f.section || 'unknown').toLowerCase().trim()}::${(f.test || 'unknown').toLowerCase().trim()}`;
}

function highKeys(round) {
  if (!round.findings) return new Set();
  return new Set(round.findings
    .filter(f => (f.confidence || '').toUpperCase() === 'HIGH')
    .map(findingKey)
  );
}

const mustFixCount = highMustFixCount(lastRound);

// Jaccard intersection of HIGH keys with previous round.
let jaccard = null;
if (prevRound) {
  const a = highKeys(lastRound);
  const b = highKeys(prevRound);
  const inter = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  jaccard = union.size === 0 ? 0 : inter.size / union.size;
}

// P-index: fraction of HIGH findings across all prior rounds that survived (do not appear
// again in any later round). Round 1 → N/A.
let pIndex = null;
if (rounds.length >= 2) {
  const allKeys = [];
  for (const r of rounds) {
    for (const f of (r.findings || [])) {
      if ((f.confidence || '').toUpperCase() === 'HIGH') {
        allKeys.push({ key: findingKey(f), round: r.n });
      }
    }
  }
  const unique = new Map();
  for (const e of allKeys) {
    if (!unique.has(e.key)) unique.set(e.key, []);
    unique.get(e.key).push(e.round);
  }
  // A finding "persisted" if it appears in only one round (was fixed and never resurfaced).
  // Findings appearing in multiple rounds = resurfaced in another wrapper → not persisted.
  let persisted = 0;
  for (const [, rs] of unique) {
    if (rs.length === 1) persisted++;
  }
  pIndex = unique.size === 0 ? 1 : persisted / unique.size;
}

// Livelock: (P<0.5) AND (Jaccard<0.5) AND (count NOT decreasing over last 2 rounds).
let livelock = false;
const round = lastRound.n ?? rounds.length;
if (round >= 2 && pIndex !== null && jaccard !== null) {
  const countNotDecreasing = prevRound ? mustFixCount >= highMustFixCount(prevRound) : true;
  livelock = (pIndex < thresholds.livelockPIndexMax) &&
             (jaccard < thresholds.livelockJaccardMax) &&
             countNotDecreasing;
}

// Novelty-stall: round ≥ 5 AND each of last 3 rounds produced ≥1 HIGH whose key isn't in any prior round.
let noveltyStall = false;
if (round >= thresholds.noveltyStallMinRound && rounds.length >= thresholds.noveltyStallWindow) {
  const window = rounds.slice(-thresholds.noveltyStallWindow);
  const priorKeys = new Set();
  // priorKeys = all HIGH keys before the window
  for (let i = 0; i < rounds.length - thresholds.noveltyStallWindow; i++) {
    for (const k of highKeys(rounds[i])) priorKeys.add(k);
  }
  const allFreshInWindow = window.every(r => {
    const ks = highKeys(r);
    if (ks.size === 0) return false; // must have ≥1 HIGH
    return [...ks].every(k => !priorKeys.has(k));
  });
  noveltyStall = allFreshInWindow;
}

// Trans-round escalation: %HIGH strictly increasing for ≥2 consecutive rounds.
let transRoundEscalation = false;
if (rounds.length >= thresholds.transRoundEscalationMinRounds) {
  const recent = rounds.slice(-thresholds.transRoundEscalationMinRounds);
  const ratios = recent.map(r => {
    const total = (r.findings || []).filter(f => (f.bucket || '').toUpperCase() === 'MUST-FIX').length;
    if (total === 0) return 0;
    const high = (r.findings || []).filter(f => (f.confidence || '').toUpperCase() === 'HIGH' && (f.bucket || '').toUpperCase() === 'MUST-FIX').length;
    return high / total;
  });
  transRoundEscalation = ratios.every((v, i, arr) => i === 0 || v > arr[i - 1]);
}

// Confidence-collapse: ≥3 consecutive rounds with 0 HIGH MUST-FIX AND non-empty Changelog.
let confidenceCollapse = false;
if (rounds.length >= thresholds.confidenceCollapseRounds && state.revisionHashes && state.revisionHashes.length > 0) {
  const recent = rounds.slice(-thresholds.confidenceCollapseRounds);
  confidenceCollapse = recent.every(r => highMustFixCount(r) === 0);
}

// Anti-overconfidence: n≥4 findings AND ≥60% HIGH for current round.
let antiOverconfidenceWarning = false;
const lastFindings = lastRound.findings || [];
if (lastFindings.length >= 4) {
  const highCount = lastFindings.filter(f => (f.confidence || '').toUpperCase() === 'HIGH').length;
  antiOverconfidenceWarning = (highCount / lastFindings.length) >= thresholds.antiOverconfidencePctHigh;
}

// Trajectory label.
let trajectoryLabel;
if (livelock) {
  trajectoryLabel = 'diverging (livelock)';
} else if (noveltyStall) {
  trajectoryLabel = 'productively non-converging (novelty-stall)';
} else if (rounds.length >= 2) {
  const counts = rounds.map(r => highMustFixCount(r));
  const monotonicDecreasing = counts.every((v, i) => i === 0 || v <= counts[i - 1]);
  const lastTwoSame = counts.length >= 2 && counts[counts.length - 1] === counts[counts.length - 2];
  if (monotonicDecreasing && counts[counts.length - 1] < counts[0]) {
    trajectoryLabel = 'converging';
  } else if (lastTwoSame) {
    trajectoryLabel = 'oscillating';
  } else {
    trajectoryLabel = 'oscillating';
  }
} else {
  trajectoryLabel = 'N/A (round 1)';
}

process.stdout.write(JSON.stringify({
  mustFixCount,
  jaccard,
  pIndex,
  livelock,
  noveltyStall,
  transRoundEscalation,
  confidenceCollapse,
  trajectoryLabel,
  antiOverconfidenceWarning,
  round,
}) + '\n');
