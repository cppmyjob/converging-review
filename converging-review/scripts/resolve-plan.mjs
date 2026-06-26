#!/usr/bin/env node
// Resolve plan source: file path, inline text, or auto-detect from standard locations.
// Outputs JSON to stdout: { planContent, canonicalHash, revisionHash, source, sourcePath?, lineCount, hadChangelog }.
// Exit codes: 0=ok, 2=no plan found, 3=ambiguous short input.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
let fromFile = null;
let positional = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from-file' && i + 1 < args.length) {
    fromFile = args[i + 1];
    i++;
  } else if (positional === '') {
    positional = args[i];
  }
}

function fail(code, message) {
  process.stderr.write(`resolve-plan: ${message}\n`);
  process.exit(code);
}

function computeHashes(content) {
  // canonicalHash strips Changelog and any v-sections to remain invariant under
  // mid-review changelog mutation (closes round-1 CM-2).
  // Strategy: remove "## Changelog" block (until next ## heading or EOF),
  // and any "### v\d+" block (until next ### or ## heading).
  // `\Z` is not a valid JS RegExp anchor (Python/Ruby/PCRE only) — it was being
  // parsed as the literal character `Z`, making the strip a no-op whenever the
  // Changelog/v-section sits at end-of-file (the normal case). Replace with
  // `$(?![\s\S])` — end-of-line in multiline mode plus a negative lookahead
  // asserting no further characters — which is the JS-portable end-of-input.
  const stripped = content
    .replace(/^## Changelog[\s\S]*?(?=^## (?!#)|$(?![\s\S]))/gm, '')
    .replace(/^### v\d+[\s\S]*?(?=^### (?!v\d)|^## |$(?![\s\S]))/gm, '');
  const canonicalHash = createHash('sha256').update(stripped).digest('hex').slice(0, 12);
  const revisionHash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return { canonicalHash, revisionHash };
}

function emit(content, source, sourcePath = null) {
  if (!content || content.trim().length === 0) {
    fail(2, 'plan content is empty');
  }
  const { canonicalHash, revisionHash } = computeHashes(content);
  const lineCount = content.split('\n').length;
  const hadChangelog = /^## Changelog/m.test(content);
  process.stdout.write(JSON.stringify({
    planContent: content,
    canonicalHash,
    revisionHash,
    source,
    sourcePath,
    lineCount,
    hadChangelog,
  }) + '\n');
}

function autoDetect() {
  const candidates = [
    join(process.cwd(), '.claude', 'plans'),
    join(homedir(), '.claude', 'plans'),
  ];
  let newest = null;
  let newestMtime = 0;
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (st.mtimeMs > newestMtime) {
        newestMtime = st.mtimeMs;
        newest = full;
      }
    }
  }
  if (!newest) {
    fail(2, 'no plans found in ~/.claude/plans/ or ./.claude/plans/; pass a path or paste text');
  }
  return newest;
}

// Branch 1: --from-file (orchestrator-prepared file from Step 1a)
if (fromFile) {
  const path = resolve(fromFile);
  if (!existsSync(path)) {
    fail(2, `--from-file path does not exist: ${path}`);
  }
  const content = readFileSync(path, 'utf-8');
  emit(content, 'file', path);
}
// Branch 2: positional path to existing file
else if (positional && existsSync(positional)) {
  const path = resolve(positional);
  const st = statSync(path);
  if (!st.isFile()) {
    fail(2, `path is not a file: ${path}`);
  }
  const content = readFileSync(path, 'utf-8');
  emit(content, 'file', path);
}
// Branch 3: positional inline text >50 chars and no newlines (multi-line goes through 1a)
else if (positional && positional.length > 50 && !positional.includes('\n')) {
  emit(positional, 'inline-text');
}
// Branch 4: positional non-empty short text — ambiguous (typo'd path or short text)
else if (positional && positional.length > 0 && positional.length <= 50) {
  fail(3, `argument is short (${positional.length} chars) and not an existing path; pass a longer plan or a valid file path`);
}
// Branch 5: empty positional → auto-detect
else {
  const path = autoDetect();
  const content = readFileSync(path, 'utf-8');
  emit(content, 'auto-detect', path);
}
