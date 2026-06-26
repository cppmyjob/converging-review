#!/usr/bin/env node
// Per-plan state read/write. Atomic writes via tmp + rename.
// Subcommands:
//   read <canonicalHash> — outputs JSON state to stdout (or empty-state JSON if missing)
//   write <canonicalHash> — reads round JSON from stdin, appends to state.rounds[]
// Storage: <cwd>/.claude/converging-review/state/<hash>.json with fallback to ~/.claude/converging-review/state/

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const [, , subcommand, hash] = process.argv;

if (!subcommand || !hash) {
  process.stderr.write('state.mjs: usage: state.mjs <read|write> <canonicalHash>\n');
  process.exit(2);
}

function pickStateDir() {
  const projectDir = join(process.cwd(), '.claude', 'converging-review', 'state');
  const homeDir = join(homedir(), '.claude', 'converging-review', 'state');
  // Prefer project-local; create if cwd is writable.
  try {
    mkdirSync(projectDir, { recursive: true });
    return projectDir;
  } catch {
    mkdirSync(homeDir, { recursive: true });
    return homeDir;
  }
}

function statePath(dir, h) {
  return join(dir, `${h}.json`);
}

function emptyState(h) {
  return {
    canonicalHash: h,
    revisionHashes: [],
    createdAt: new Date().toISOString(),
    currentRound: 0,
    rounds: [],
  };
}

function waitForTmpClear(dir, h, maxMs = 2000) {
  // Concurrent-session guard: if a .tmp.* file is found alongside the target,
  // wait briefly before retrying. Simple busy-wait (no async needed for CLI script).
  const target = `${h}.json`;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    const inProgress = entries.some(n => n.startsWith(target) && n.includes('.tmp.'));
    if (!inProgress) return;
    // Spin; native sleep would need child_process. Cheap busy-wait acceptable for ≤2s.
    const spinUntil = Date.now() + 50;
    while (Date.now() < spinUntil) { /* spin */ }
  }
}

function readState(h) {
  const dir = pickStateDir();
  waitForTmpClear(dir, h);
  const path = statePath(dir, h);
  if (!existsSync(path)) {
    return emptyState(h);
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`state.mjs: failed to parse ${path}: ${err.message}\n`);
    process.stderr.write('state.mjs: returning empty state\n');
    return emptyState(h);
  }
}

function writeState(h) {
  const dir = pickStateDir();
  waitForTmpClear(dir, h);
  const path = statePath(dir, h);

  let stdinChunks = [];
  process.stdin.on('data', c => stdinChunks.push(c));
  process.stdin.on('end', () => {
    let roundData;
    try {
      const raw = Buffer.concat(stdinChunks).toString('utf-8');
      roundData = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(`state.mjs: invalid JSON on stdin: ${err.message}\n`);
      process.exit(2);
    }
    const state = readState(h);
    if (!Array.isArray(state.rounds)) state.rounds = [];
    if (!Array.isArray(state.revisionHashes)) state.revisionHashes = [];

    // Round counter authority: max(stored+1, count of "### v\d+" + 1) is computed
    // by metrics/orchestrator before write. Trust roundData.n if provided.
    state.rounds.push(roundData);
    if (roundData.n) state.currentRound = roundData.n;
    if (roundData.revisionHash && !state.revisionHashes.includes(roundData.revisionHash)) {
      state.revisionHashes.push(roundData.revisionHash);
    }

    const tmpPath = `${path}.tmp.${process.pid}`;
    try {
      writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
      renameSync(tmpPath, path);
    } catch (err) {
      // Cleanup tmp if rename failed.
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
      process.stderr.write(`state.mjs: write failed: ${err.message}\n`);
      process.exit(2);
    }
    process.stdout.write(JSON.stringify({ ok: true, path, currentRound: state.currentRound }) + '\n');
  });
}

if (subcommand === 'read') {
  const state = readState(hash);
  process.stdout.write(JSON.stringify(state) + '\n');
} else if (subcommand === 'write') {
  writeState(hash);
} else {
  process.stderr.write(`state.mjs: unknown subcommand: ${subcommand}\n`);
  process.exit(2);
}
