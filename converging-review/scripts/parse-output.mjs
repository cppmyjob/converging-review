#!/usr/bin/env node
// Parse subagent output text (stdin) for the JSON marker block + plain-text trailer fallback.
// Usage: cat agent-output.txt | node parse-output.mjs <agent-id>
// Outputs JSON: { ok, agent, round, counters, findings, source: "json"|"trailer", quarantine? }

const agentId = process.argv[2] || 'unknown';

let chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  const text = Buffer.concat(chunks).toString('utf-8');
  const result = parse(text, agentId);
  process.stdout.write(JSON.stringify(result) + '\n');
});

function parse(text, agent) {
  // Try JSON first: find the LAST 4-tick or 3-tick fenced JSON block whose body contains
  // _marker: "self-critique-final".
  const blocks = findFencedJsonBlocks(text);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const body = blocks[i];
    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed._marker === 'self-critique-final') {
        return {
          ok: true,
          agent: parsed.agent || agent,
          round: parsed.round ?? null,
          counters: parsed.counters || null,
          findings: parsed.findings || [],
          source: 'json',
        };
      }
    } catch {
      continue;
    }
  }

  // Fallback: regex on plain-text trailer.
  const trailerRegex = /Self-critique log:\s*auto-rejected=(\d+),\s*kept=(\d+),\s*to-CLARIFICATION=(\d+),\s*final HIGH=(\d+),\s*MED=(\d+),\s*LOW=(\d+)/i;
  const m = text.match(trailerRegex);
  if (m) {
    return {
      ok: true,
      agent,
      round: null,
      counters: {
        auto_rejected: Number(m[1]),
        kept: Number(m[2]),
        to_clarification: Number(m[3]),
        final_high: Number(m[4]),
        med: Number(m[5]),
        low: Number(m[6]),
      },
      findings: [],
      source: 'trailer',
      note: 'JSON marker missing or malformed; counters recovered from plain-text trailer; findings array unavailable',
    };
  }

  return {
    ok: false,
    agent,
    round: null,
    counters: null,
    findings: [],
    source: 'none',
    quarantine: true,
    note: 'neither JSON marker nor plain-text trailer present',
  };
}

function findFencedJsonBlocks(text) {
  // Match both ```json and ````json fences (3-tick and 4-tick).
  // Return array of block bodies (without fences).
  const blocks = [];
  const fenceRegex = /(`{3,4})json\s*\n([\s\S]*?)\n\1/gi;
  let match;
  while ((match = fenceRegex.exec(text)) !== null) {
    blocks.push(match[2]);
  }
  // Also try unfenced JSON objects containing _marker (defensive).
  if (blocks.length === 0) {
    const looseRegex = /\{[\s\S]*?"_marker"\s*:\s*"self-critique-final"[\s\S]*?\}/g;
    let m;
    while ((m = looseRegex.exec(text)) !== null) {
      blocks.push(m[0]);
    }
  }
  return blocks;
}
