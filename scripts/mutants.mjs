// -----------------------------------------------------------------------------
// Mutation check of the guards and of cce66's additions (not in the image, not run by the CI):
// each mutant of scripts/mutants.json is applied to its own copy of the
// repository (in a fresh temporary directory, node_modules copied, never
// installed, never linked), the test files are run, and the whole process group is killed at
// the deadline. A guard whose mutant survives needs a test; a mutant must make
// a test FAIL, never hang.
// Run: node scripts/mutants.mjs [indexes, e.g. 3,7]   (one at a time; use memcap)
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const list = JSON.parse(readFileSync(join(REPO, 'scripts/mutants.json'), 'utf8'));
const only = process.argv[2] ? new Set(process.argv[2].split(',').map(Number)) : undefined;
const TESTS = readdirSync(join(REPO, 'test'))
  .filter((f) => f.endsWith('.test.js') && f !== 'release.test.js')
  .map((f) => `test/${f}`);
const DEADLINE = 150_000;

function run(dir) {
  return new Promise((resolve) => {
    // eslint-disable-next-line no-unused-vars
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const child = spawn(process.execPath, ['--test', '--test-timeout=30000', ...TESTS], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
      resolve({ code: 'HUNG', out });
    }, DEADLINE);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

let survivors = 0;
const base = mkdtempSync(join(tmpdir(), 'ipx800v3-mutants-'));
// A real copy of everything, node_modules included: never a link to the shared repository
// (an `npm ci` in a copy would empty it).
const copy = (dir) =>
  cpSync(REPO, dir, { recursive: true, filter: (src) => basename(src) !== '.git' });
try {
  // The unmutated suite first: a suite already red would mark every mutant "killed".
  const clean = mkdtempSync(join(base, 'clean-'));
  copy(clean);
  const baseline = await run(clean);
  rmSync(clean, { recursive: true, force: true });
  if (baseline.code !== 0) {
    console.log(`baseline ${baseline.code === 'HUNG' ? 'HUNG' : 'FAILED'}: fix the suite first`);
    console.log(
      baseline.out
        .split('\n')
        .filter((l) => /^not ok|✖/.test(l))
        .slice(0, 10)
        .join('\n'),
    );
    survivors = -1;
  }
  for (const [i, m] of list.entries()) {
    if (survivors < 0) break;
    if (only && !only.has(i)) continue;
    const dir = mkdtempSync(join(base, 'm-'));
    try {
      copy(dir);
      const file = join(dir, m.file);
      const text = readFileSync(file, 'utf8');
      const n = text.split(m.from).length - 1;
      if (n !== 1) {
        console.log(`#${i} BADMATCH(${n}) ${m.name}`);
        survivors += 1;
        continue;
      }
      writeFileSync(file, text.replace(m.from, m.to));
      const { code } = await run(dir);
      const verdict = code === 0 ? 'SURVIVED' : code === 'HUNG' ? 'HUNG' : 'killed';
      if (verdict !== 'killed') survivors += 1;
      console.log(`#${i} ${verdict} ${m.name}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}
process.exitCode = survivors === 0 ? 0 : 1;
