#!/usr/bin/env node
// Apply per-agent MUST-FIX caps. Items exceeding cap move to SHOULD-DEFER with isCapOverflow=true.
// Cap-overflow items remain counted in convergence metrics (handled by metrics.mjs).
// Usage: cat findings.json | node caps.mjs
// Input: { av: [{...}], lc: [...], cm: [...], pm: [...] }
// Output: { mustFix: [...], shouldDefer: [...], requiresClarification: [...], capOverflowAgents: [...] }

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const thresholds = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'thresholds.json'), 'utf-8'));
const CAPS = thresholds.perAgentCaps;

let chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch (err) {
    process.stderr.write(`caps.mjs: invalid JSON on stdin: ${err.message}\n`);
    process.exit(2);
  }

  const mustFix = [];
  const shouldDefer = [];
  const requiresClarification = [];
  const capOverflowAgents = [];

  for (const agentKey of ['av', 'lc', 'cm', 'pm']) {
    const cap = CAPS[agentKey] ?? 5;
    const findings = Array.isArray(input[agentKey]) ? input[agentKey] : [];

    // Sort by confidence: HIGH first, then MED, then LOW; ties first-seen.
    const sorted = stableSort(findings, (a, b) => confRank(a.confidence) - confRank(b.confidence));

    const agentMustFix = [];
    const agentShouldDefer = [];
    const agentClarif = [];

    for (const f of sorted) {
      const bucket = (f.bucket || '').toUpperCase().replace(/_/g, '-');
      if (bucket === 'MUST-FIX' && (f.confidence || '').toUpperCase() === 'HIGH') {
        if (agentMustFix.length < cap) {
          agentMustFix.push({ ...f, agent: agentKey, isCapOverflow: false });
        } else {
          agentShouldDefer.push({ ...f, agent: agentKey, isCapOverflow: true, originalBucket: 'MUST-FIX' });
        }
      } else if (bucket === 'REQUIRES CLARIFICATION' || bucket === 'REQUIRES-CLARIFICATION' || bucket === 'CLARIFICATION') {
        agentClarif.push({ ...f, agent: agentKey });
      } else {
        // SHOULD-DEFER and everything else.
        agentShouldDefer.push({ ...f, agent: agentKey, isCapOverflow: false });
      }
    }

    const overflowCount = agentShouldDefer.filter(x => x.isCapOverflow).length;
    if (overflowCount > 0) {
      capOverflowAgents.push({ agent: agentKey, count: overflowCount });
    }

    mustFix.push(...agentMustFix);
    shouldDefer.push(...agentShouldDefer);
    requiresClarification.push(...agentClarif);
  }

  process.stdout.write(JSON.stringify({
    mustFix,
    shouldDefer,
    requiresClarification,
    capOverflowAgents,
  }) + '\n');
});

function confRank(c) {
  switch ((c || '').toUpperCase()) {
    case 'HIGH': return 0;
    case 'MED': return 1;
    case 'LOW': return 2;
    default: return 3;
  }
}

function stableSort(arr, cmp) {
  return arr.map((x, i) => [x, i]).sort(([a, ai], [b, bi]) => {
    const r = cmp(a, b);
    return r !== 0 ? r : ai - bi;
  }).map(([x]) => x);
}
