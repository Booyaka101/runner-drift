import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  MIGRATIONS,
  MIGRATION_PHASE,
  MIGRATION_STATE,
  migrationBetween,
  migrationFails,
  migrationFor,
  migrationStatus,
} from '../src/labels.mjs';
import { attributeImageOS, imageDiffs, surveyMigration } from '../src/migration.mjs';
import { migrationAnnotations, migrationLines, migrationSummaryMarkdown } from '../src/report.mjs';
import { detect, extractFloatingSites } from '../src/detect.mjs';
import { writeLock } from '../src/lock.mjs';
import { runGuard, runPlan, EXIT_OK, EXIT_DRIFT, EXIT_USAGE } from '../src/cli.mjs';
import { captureIO, fixtureLoader, FIXTURES } from './helpers.mjs';

const WORKFLOWS = path.join(FIXTURES, 'workflows-migration');

// The clock is injected everywhere below, never read from the host: these
// assertions have to mean the same thing after the window has passed.
const BEFORE = new Date('2026-10-01T00:00:00Z');
const DURING = new Date('2026-10-25T00:00:00Z');
const AFTER = new Date('2026-11-25T00:00:00Z');

// ubuntu-24.04 has several snapshots; the migration wants the one that was
// current alongside the Ubuntu 26.04 image, or the kernel delta is fiction.
const LOAD = fixtureLoader({ 'ubuntu-24.04': 'ubuntu-24.04@2026-09' });

const TOOLS = ['CMake', 'Node.js', 'Python', 'Rust'];

async function survey(now, imageOS = null, opts = {}) {
  return surveyMigration({
    label: 'ubuntu-latest',
    now,
    imageOS,
    tools: TOOLS,
    load: LOAD,
    ...opts,
  });
}

/* -------------------------------------------------------------- the table */

test('MIGRATIONS transcribes the changelog window and cites its source', () => {
  const m = MIGRATIONS['ubuntu-latest'];
  assert.deepEqual(
    { from: m.from, to: m.to, starts: m.starts, ends: m.ends, announced: m.announced },
    {
      from: 'ubuntu-24.04',
      to: 'ubuntu-26.04',
      starts: '2026-10-19',
      ends: '2026-11-19',
      announced: '2026-09-17',
    },
  );
  assert.equal(m.sourceRef, 'actions/runner-images#14748');
  assert.equal(m.source, 'https://github.com/actions/runner-images/issues/14748');
});

test('MIGRATIONS does not reuse the DEADLINES vocabulary', () => {
  for (const m of Object.values(MIGRATIONS)) {
    assert.equal(m.migrateTo, undefined, 'migrateTo means something else in DEADLINES');
    assert.equal(m.fullyUnsupported, undefined);
  }
});

/* -------------------------------------------------------- migrationStatus */

test('pending: the window has not opened, countdown is whole days', () => {
  const s = migrationStatus('ubuntu-latest', { now: BEFORE });
  assert.equal(s.phase, MIGRATION_PHASE.PENDING);
  assert.equal(s.state, MIGRATION_STATE.PENDING);
  assert.equal(s.daysToStart, 18);
  assert.equal(s.daysToEnd, 49);
  assert.equal(s.anomaly, false);
  assert.equal(s.done, false);
});

test('in-window on the from-image: not yet migrated, not an anomaly', () => {
  const s = migrationStatus('ubuntu-latest', { now: DURING, imageOS: 'ubuntu24' });
  assert.equal(s.phase, MIGRATION_PHASE.IN_WINDOW);
  assert.equal(s.state, MIGRATION_STATE.NOT_YET_MIGRATED);
  assert.equal(s.observed, 'ubuntu-24.04');
  assert.equal(s.anomaly, false);
  assert.equal(s.daysToEnd, 25);
});

test('in-window on the to-image: the migration reached this runner', () => {
  const s = migrationStatus('ubuntu-latest', { now: DURING, imageOS: 'ubuntu26' });
  assert.equal(s.state, MIGRATION_STATE.MIGRATED);
  assert.equal(s.observed, 'ubuntu-26.04');
  assert.equal(s.done, true);
  assert.equal(s.anomaly, false);
});

test('settled and correct: the label now means the new image', () => {
  assert.equal(
    migrationStatus('ubuntu-latest', { now: AFTER, imageOS: 'ubuntu26' }).state,
    MIGRATION_STATE.MIGRATED,
  );
  const blind = migrationStatus('ubuntu-latest', { now: AFTER });
  assert.equal(blind.phase, MIGRATION_PHASE.SETTLED);
  assert.equal(blind.state, MIGRATION_STATE.SETTLED);
  assert.equal(blind.done, true);
  assert.equal(blind.daysToEnd, -6);
});

test('settled on the old image is an anomaly, not drift', () => {
  const s = migrationStatus('ubuntu-latest', { now: AFTER, imageOS: 'ubuntu24' });
  assert.equal(s.state, MIGRATION_STATE.STALE);
  assert.equal(s.anomaly, true);
  assert.equal(s.done, false);
});

test('missing ImageOS: the calendar alone still decides pending and settled', () => {
  assert.equal(migrationStatus('ubuntu-latest', { now: BEFORE }).state, MIGRATION_STATE.PENDING);
  assert.equal(migrationStatus('ubuntu-latest', { now: AFTER }).state, MIGRATION_STATE.SETTLED);
  const mid = migrationStatus('ubuntu-latest', { now: DURING });
  assert.equal(mid.state, MIGRATION_STATE.AMBIGUOUS);
  assert.equal(mid.observed, null);
  assert.equal(mid.anomaly, false, 'not knowing is not a fault');
});

test('an image that arrived before the window opened reads as early, not wrong', () => {
  const s = migrationStatus('ubuntu-latest', { now: BEFORE, imageOS: 'ubuntu26' });
  assert.equal(s.state, MIGRATION_STATE.MOVED_EARLY);
  assert.equal(s.done, true);
});

test('a known image that is neither end of the window is an anomaly', () => {
  const s = migrationStatus('ubuntu-latest', { now: DURING, imageOS: 'ubuntu22' });
  assert.equal(s.state, MIGRATION_STATE.UNEXPECTED);
  assert.equal(s.observed, 'ubuntu-22.04');
  assert.equal(s.anomaly, true);
});

test('an ImageOS this build has never heard of reads as no observation', () => {
  // guard already warns about an unknown ImageOS on its own. Guessing here
  // would turn every future image name into a fake anomaly.
  const s = migrationStatus('ubuntu-latest', { now: DURING, imageOS: 'ubuntu28' });
  assert.equal(s.state, MIGRATION_STATE.AMBIGUOUS);
  assert.equal(s.observed, null);
  assert.equal(s.anomaly, false);
});

test('no migration configured behaves exactly as before: null', () => {
  assert.equal(migrationFor('windows-latest'), null);
  assert.equal(migrationStatus('windows-latest', { now: DURING }), null);
  assert.equal(migrationStatus('macos-latest', { now: DURING }), null);
});

test('a pinned concrete label is never treated as migrating', () => {
  for (const label of ['ubuntu-24.04', 'ubuntu-26.04', 'ubuntu-22.04', 'macos-15']) {
    assert.equal(migrationStatus(label, { now: DURING, imageOS: 'ubuntu24' }), null, label);
  }
});

test('a date outside every window still classifies, never throws', () => {
  for (const when of ['2020-01-01', '2099-01-01']) {
    const s = migrationStatus('ubuntu-latest', { now: new Date(`${when}T00:00:00Z`) });
    assert.ok(Object.values(MIGRATION_STATE).includes(s.state));
  }
});

test('the window boundaries belong to the window', () => {
  const on = (d) => migrationStatus('ubuntu-latest', { now: new Date(`${d}T00:00:00Z`) }).phase;
  assert.equal(on('2026-10-18'), MIGRATION_PHASE.PENDING);
  assert.equal(on('2026-10-19'), MIGRATION_PHASE.IN_WINDOW);
  assert.equal(on('2026-11-19'), MIGRATION_PHASE.IN_WINDOW);
  assert.equal(on('2026-11-20'), MIGRATION_PHASE.SETTLED);
});

test('the phase holds all day, at every hour of a boundary date', () => {
  for (const hour of ['00:00', '11:59', '12:00', '13:00', '23:59']) {
    const at = (d) => migrationStatus('ubuntu-latest', { now: new Date(`${d}T${hour}:00Z`) });
    assert.equal(at('2026-10-18').phase, MIGRATION_PHASE.PENDING, `2026-10-18 ${hour}`);
    assert.equal(at('2026-10-19').phase, MIGRATION_PHASE.IN_WINDOW, `2026-10-19 ${hour}`);
    assert.equal(at('2026-11-19').phase, MIGRATION_PHASE.IN_WINDOW, `2026-11-19 ${hour}`);
    assert.equal(at('2026-11-19').daysToEnd, 0, `countdown on the last day, ${hour}`);
    assert.equal(at('2026-11-20').phase, MIGRATION_PHASE.SETTLED, `2026-11-20 ${hour}`);
  }
});

/* --------------------------------------------------------- migrationFails */

test('the gate fires inside the threshold, in the window, and on an anomaly', () => {
  const pending = migrationStatus('ubuntu-latest', { now: BEFORE });
  assert.equal(migrationFails(pending, 10), false, '18 days out, threshold 10');
  assert.equal(migrationFails(pending, 18), true, 'threshold meets the countdown');

  assert.equal(migrationFails(migrationStatus('ubuntu-latest', { now: DURING }), 0), true);
  assert.equal(
    migrationFails(migrationStatus('ubuntu-latest', { now: AFTER, imageOS: 'ubuntu24' }), 0),
    true,
    'an anomaly fires whatever the threshold',
  );
  assert.equal(
    migrationFails(migrationStatus('ubuntu-latest', { now: AFTER, imageOS: 'ubuntu26' }), 10000),
    false,
    'a completed migration is not a failure',
  );
  assert.equal(migrationFails(null, 0), false);
});

/* -------------------------------------------------------- surveyMigration */

test('pending: the manifest diff is the kernel and systemd move, from real snapshots', async () => {
  const s = await survey(BEFORE);
  assert.equal(s.state, MIGRATION_STATE.PENDING);
  assert.deepEqual(s.images, { from: '20260907.300.1', to: '20260907.131.1' });
  assert.deepEqual(
    s.image.map((d) => [d.tool, d.from[0], d.to[0]]),
    [
      ['OS', '24.04.5 LTS', '26.04.1 LTS'],
      ['Kernel', '6.17.0-1022-azure', '7.0.0-1012-azure'],
      ['Systemd', '255.4-1ubuntu8.17', '259.5-0ubuntu3.4'],
    ],
  );
});

test('only tools that actually move are listed', async () => {
  const s = await survey(BEFORE);
  assert.deepEqual(
    s.toolDiffs.map((d) => `${d.tool} ${d.from[0]} -> ${d.to[0]}`),
    ['CMake 3.31.6 -> 4.4.3', 'Node.js 22.23.2 -> 24.20.0', 'Python 3.12.3 -> 3.14.4'],
  );
  assert.ok(!s.toolDiffs.some((d) => d.tool === 'Rust'), 'Rust 1.98.1 is the same on both images');
});

test('a settled migration skips the manifest fetch entirely', async () => {
  const calls = [];
  const s = await survey(AFTER, 'ubuntu26', {
    load: (label) => {
      calls.push(label);
      return LOAD(label);
    },
  });
  assert.equal(s.state, MIGRATION_STATE.MIGRATED);
  assert.deepEqual(calls, [], 'the lock diff is the before/after once the label has moved');
  assert.deepEqual(s.image, []);
});

test('a 404 degrades to the notice instead of losing it', async () => {
  const s = await survey(BEFORE, null, {
    load: async (label) => ({ skipped: true, label, reason: `No manifest at ${label} (404).` }),
  });
  assert.equal(s.state, MIGRATION_STATE.PENDING);
  assert.equal(s.images, null);
  assert.deepEqual(s.image, []);
  assert.equal(s.notes.length, 2);
  assert.match(s.notes[0], /No manifest at ubuntu-24\.04 \(404\)/);
  assert.match(migrationLines(s).join('\n'), /Manifest diff unavailable: No manifest/);
});

test('a network failure degrades the same way', async () => {
  const s = await survey(BEFORE, null, {
    load: async () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.equal(s.state, MIGRATION_STATE.PENDING);
  assert.match(s.notes[0], /fetch failed/);
  assert.match(migrationLines(s).join('\n'), /rollout starts 2026-10-19 \(18 days\)/);
});

test('a tool on neither image is skipped, not diffed to nothing', async () => {
  const s = await survey(BEFORE, null, { tools: [...TOOLS, 'Xcode'] });
  assert.deepEqual(s.notOnManifest, ['Xcode'], 'Xcode is a macOS tool, absent from both');
  assert.ok(!s.toolDiffs.some((d) => d.tool === 'Xcode'));
});

test('surveying a label with no migration is null, not an empty survey', async () => {
  assert.equal(await survey(BEFORE, null, { label: 'windows-latest' }), null);
  assert.equal(await survey(BEFORE, null, { label: 'ubuntu-24.04' }), null);
});

test('imageDiffs tolerates a manifest with no kernel or systemd line', () => {
  const rows = imageDiffs({ osVersion: '15.6' }, { osVersion: '26.0' });
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.filter((d) => d.changed).map((d) => d.tool),
    ['OS'],
  );
});

/* ----------------------------------------------------------------- report */

test('each state gets its own sentence, and the anomaly says so', async () => {
  const sentence = (now, imageOS) =>
    migrationLines({
      ...migrationStatus('ubuntu-latest', { now, imageOS }),
      sites: [],
      image: [],
      toolDiffs: [],
      notOnManifest: [],
      notes: [],
    })[0];
  assert.match(
    sentence(BEFORE, null),
    /moves from ubuntu-24\.04 to ubuntu-26\.04.*starts 2026-10-19 \(18 days\)/,
  );
  assert.match(sentence(DURING, 'ubuntu24'), /this runner served ubuntu-24\.04/);
  assert.match(sentence(DURING, 'ubuntu26'), /has reached this runner/);
  assert.match(sentence(DURING, null), /not known here/);
  assert.match(sentence(AFTER, null), /finished migrating/);
  assert.match(sentence(AFTER, 'ubuntu24'), /anomaly, not drift/);
  assert.match(sentence(AFTER, 'ubuntu22'), /neither ubuntu-24\.04 nor ubuntu-26\.04/);
});

test('annotations land on the runs-on line and pick the right severity', async () => {
  const sites = (await detect(WORKFLOWS)).floatingSites;
  const at = async (now, imageOS) => migrationAnnotations([await survey(now, imageOS, { sites })])[0];

  assert.match(await at(BEFORE, null), /^::notice file=[^,]*latest\.yml,line=6,col=14,/);
  assert.match(
    await at(BEFORE, null),
    /title=runner-drift: ubuntu-latest becomes ubuntu-26\.04 in 18 days::/,
  );
  assert.match(await at(DURING, 'ubuntu24'), /^::warning file=/);
  assert.match(await at(DURING, 'ubuntu26'), /^::notice file=/);
  assert.match(await at(AFTER, 'ubuntu24'), /^::error file=/);
  assert.match(
    await at(AFTER, 'ubuntu24'),
    /See https:\/\/github\.com\/actions\/runner-images\/issues\/14748/,
  );
});

test('a survey with no site on disk still gets one step-level annotation', async () => {
  const [line] = migrationAnnotations([await survey(BEFORE)]);
  assert.ok(!line.includes('file='));
  assert.match(line, /^::notice title=runner-drift: /);
});

test('the step summary names the window, the phase and the image diff', async () => {
  const md = migrationSummaryMarkdown([await survey(BEFORE)]);
  assert.match(md, /^## runner-drift — floating label migration/);
  assert.match(md, /\| Label \| Phase \| Move \| Window \| This runner \| Source \|/);
  assert.match(
    md,
    /\| `ubuntu-latest` \| 🗓 pending \| `ubuntu-24\.04` → `ubuntu-26\.04` \| 2026-10-19 \(18 days\) → 2026-11-19 \(49 days\) \| — \| \[actions\/runner-images#14748\]/,
  );
  assert.match(md, /\| Kernel \| 6\.17\.0-1022-azure \| 7\.0\.0-1012-azure \| 🔴 MAJOR \|/);
});

test('a floating label inside a matrix is a site like any other', () => {
  const y = [
    'jobs:',
    '  a:',
    '    strategy:',
    '      matrix:',
    '        os: [ubuntu-22.04, ubuntu-latest]',
    '    runs-on: ${{ matrix.os }}',
  ].join('\n');
  assert.deepEqual(extractFloatingSites(y, 'ci.yml'), [
    { label: 'ubuntu-latest', file: 'ci.yml', line: 5, col: 28, job: 'a', viaMatrix: true },
  ]);
});

/* ------------------------------------------------------------------- plan */

async function plan(opts, now = BEFORE) {
  const cap = captureIO();
  const code = await runPlan({ workflows: WORKFLOWS, ...opts }, cap.io, { loadManifest: LOAD, now });
  return { code, stdout: cap.stdout, stderr: cap.stderr };
}

test('plan --from ubuntu-latest resolves the window and diffs the two images', async () => {
  const r = await plan({ from: 'ubuntu-latest' });
  assert.equal(r.code, EXIT_OK);
  const lines = r.stdout.trimEnd().split('\n');
  assert.equal(
    lines[0],
    'ubuntu-latest moves from ubuntu-24.04 to ubuntu-26.04. The rollout starts 2026-10-19 (18 days) and finishes 2026-11-19 (49 days).',
  );
  assert.equal(
    lines[1],
    'announced 2026-09-17; source actions/runner-images#14748 https://github.com/actions/runner-images/issues/14748',
  );
  assert.equal(lines[2], 'ubuntu-24.04 -> ubuntu-26.04 (images 20260907.300.1 -> 20260907.131.1)');
  assert.ok(r.stdout.includes('Kernel 6.17.0-1022-azure -> 7.0.0-1012-azure  MAJOR'));
  assert.ok(r.stdout.includes('Systemd 255.4-1ubuntu8.17 -> 259.5-0ubuntu3.4  MAJOR'));
});

test('an explicit --to still refuses a floating label, and says to drop it', async () => {
  const r = await plan({ from: 'ubuntu-latest', to: 'ubuntu-26.04' });
  assert.equal(r.code, EXIT_USAGE);
  assert.match(r.stderr, /floating label/);
  assert.match(r.stderr, /Or drop --to: runner-drift plan --from ubuntu-latest/);
});

test('a floating --to with no migration of its own gets no such hint', async () => {
  const r = await plan({ from: 'ubuntu-24.04', to: 'windows-latest' });
  assert.equal(r.code, EXIT_USAGE);
  assert.match(r.stderr, /--to windows-latest is a floating label/);
  assert.doesNotMatch(r.stderr, /Or drop --to/);
});

test('a floating label with no migration is still a usage error that says so', async () => {
  const r = await plan({ from: 'windows-latest' });
  assert.equal(r.code, EXIT_USAGE);
  assert.match(r.stderr, /plan needs both --from <label> and --to <label>/);
  assert.match(r.stderr, /need only --from: ubuntu-latest/);
});

test('plan --json carries the migration and the image diff', async () => {
  const r = await plan({ from: 'ubuntu-latest', json: true });
  const j = JSON.parse(r.stdout);
  assert.equal(j.from, 'ubuntu-24.04');
  assert.equal(j.to, 'ubuntu-26.04');
  assert.equal(j.migration.state, 'pending');
  assert.equal(j.migration.daysToStart, 18);
  assert.deepEqual(
    j.image.map((d) => d.tool),
    ['OS', 'Kernel', 'Systemd'],
  );
});

/* ------------------------------------------------------------------ guard */

async function guard(opts, env = {}, now = BEFORE) {
  const cap = captureIO();
  const code = await runGuard(
    { summary: false, 'update-lock': true, workflows: WORKFLOWS, ...opts },
    cap.io,
    env,
    { now, loadManifest: LOAD },
  );
  return { code, stdout: cap.stdout, stderr: cap.stderr };
}

test('guard is unchanged without the flag: no migration output at all', async () => {
  const r = await guard({ tools: 'node' });
  assert.equal(r.code, EXIT_OK);
  assert.ok(!r.stdout.includes('ubuntu-latest'));
  assert.equal(r.stderr, '');
});

test('guard --fail-on-migration reports the pending window and the diff', async () => {
  const r = await guard({ tools: 'node', 'fail-on-migration': '30' });
  assert.equal(r.code, EXIT_DRIFT);
  assert.match(r.stdout, /^::notice file=.*latest\.yml,line=6,col=14,/m);
  assert.match(r.stdout, /rollout starts 2026-10-19 \(18 days\)/);
  assert.match(r.stdout, /Kernel 6\.17\.0-1022-azure -> 7\.0\.0-1012-azure/);
  assert.match(r.stderr, /--fail-on-migration 30 is set\./);
});

test('below the threshold it reports and exits 0', async () => {
  const r = await guard({ tools: 'node', 'fail-on-migration': '10' });
  assert.equal(r.code, EXIT_OK);
  assert.match(r.stdout, /rollout starts 2026-10-19/);
  assert.equal(r.stderr, '');
});

test('a stale runner after the window fails whatever the threshold', async () => {
  const r = await guard({ tools: 'node', 'fail-on-migration': '0' }, { ImageOS: 'ubuntu24' }, AFTER);
  assert.equal(r.code, EXIT_DRIFT);
  assert.match(r.stdout, /^::error file=/m);
  assert.match(r.stderr, /anomaly, not drift/);
  assert.ok(!r.stderr.includes('--fail-on-migration 0 is set'), 'an anomaly is not a countdown');
});

test('a workflow with no floating label produces nothing and exits 0', async () => {
  const r = await guard({
    tools: 'node',
    'fail-on-migration': '365',
    workflows: path.join(FIXTURES, 'workflows'),
  });
  assert.equal(r.code, EXIT_OK);
  assert.ok(!r.stdout.includes('ubuntu-latest'));
  assert.equal(r.stderr, '');
});

test('a missing workflow directory is a notice, not an error', async () => {
  const r = await guard({
    tools: 'node',
    'fail-on-migration': '30',
    workflows: path.join(FIXTURES, 'definitely-not-here'),
  });
  assert.equal(r.code, EXIT_OK);
  assert.match(r.stdout, /::notice title=runner-drift::No workflow directory/);
  assert.match(r.stdout, /no floating labels to check for migration/);
});

test('a bad --fail-on-migration value is a usage error', async () => {
  for (const bad of ['soon', '-5', '2.5', '']) {
    const r = await guard({ tools: 'node', 'fail-on-migration': bad });
    assert.equal(r.code, EXIT_USAGE, `"${bad}" rejected`);
    assert.match(r.stderr, /--fail-on-migration needs a whole number of days >= 0/);
  }
});

test('the migration ride-along appears in guard --json', async () => {
  const r = await guard({ tools: 'node', 'fail-on-migration': '30', json: true });
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  assert.equal(j.migration.days, 30);
  assert.equal(j.migration.surveys.length, 1);
  assert.equal(j.migration.surveys[0].state, 'pending');
  assert.equal(j.migration.surveys[0].sites[0].line, 6);
});

/* ------------------------------------------------ whose image is this? */

// The fixture has three jobs: build on ubuntu-latest, pinned on ubuntu-24.04,
// lint on ubuntu-22.04. A runner exports these two for the job it is serving.
const inJob = (job) => ({
  GITHUB_JOB: job,
  GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/latest.yml@refs/heads/main',
});

test('a guard step on an unrelated image says nothing about the floating label', async () => {
  const r = await guard(
    { tools: 'node', 'fail-on-migration': '0', json: true },
    { ImageOS: 'ubuntu22', ...inJob('lint') },
    BEFORE,
  );
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  const s = j.migration.surveys[0];
  assert.equal(s.state, MIGRATION_STATE.PENDING, 'the lint runner is not evidence');
  assert.equal(s.observed, null);
  assert.match(s.notes[0], /did not run on ubuntu-latest/);
  assert.equal(r.code, EXIT_OK, 'another job image is not an anomaly');
  assert.ok(!r.stdout.includes('::error'), 'nothing to raise');
});

test('the job that does ask for the label owns the image it ran on', async () => {
  const r = await guard(
    { tools: 'node', 'fail-on-migration': '0', json: true },
    { ImageOS: 'ubuntu22', ...inJob('build') },
    BEFORE,
  );
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  assert.equal(j.migration.surveys[0].state, MIGRATION_STATE.UNEXPECTED);
  assert.deepEqual(j.migration.surveys[0].notes, []);
  assert.equal(r.code, EXIT_DRIFT, 'ubuntu-latest serving 22.04 is a real anomaly');
});

test('mid-window, the job on the floating label still reads as migrated', async () => {
  const r = await guard(
    { tools: 'node', 'fail-on-migration': '30', json: true },
    { ImageOS: 'ubuntu26', ...inJob('build') },
    DURING,
  );
  const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  assert.equal(j.migration.surveys[0].state, MIGRATION_STATE.MIGRATED);
  assert.equal(j.migration.surveys[0].observed, 'ubuntu-26.04');
});

test('a matrix leg is trusted for the two images in the window and no others', () => {
  const site = { label: 'ubuntu-latest', file: 'ci.yml', line: 5, col: 28, job: 'a', viaMatrix: true };
  const here = { job: 'a', file: 'ci.yml' };
  assert.equal(attributeImageOS({ label: 'ubuntu-latest', imageOS: 'ubuntu26', sites: [site], here }).imageOS, 'ubuntu26');
  const off = attributeImageOS({ label: 'ubuntu-latest', imageOS: 'ubuntu22', sites: [site], here });
  assert.equal(off.imageOS, null, 'this runner is serving another leg');
  assert.match(off.note, /through a matrix/);
});

test('with no GITHUB_JOB the window images are still attributed', () => {
  const sites = [{ label: 'ubuntu-latest', file: 'ci.yml', line: 6, col: 14, job: 'build' }];
  const a = attributeImageOS({ label: 'ubuntu-latest', imageOS: 'ubuntu24', sites, here: null });
  assert.equal(a.imageOS, 'ubuntu24');
  assert.equal(a.note, null);
  const b = attributeImageOS({ label: 'ubuntu-latest', imageOS: 'ubuntu22', sites, here: null });
  assert.equal(b.imageOS, null);
  assert.match(b.note, /This check did not run on ubuntu-latest/);
});

/**
 * Guard against a lock recorded on the pre-migration image, with the runner
 * serving the post-migration one: the drift a real user sees mid-rollout.
 */
async function guardAcrossTheMove(opts, now, locked = { label: 'ubuntu-24.04', imageOS: 'ubuntu24' }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'runner-drift-migration-'));
  const lockFile = path.join(dir, 'runner-lock.json');
  const IMAGE = '20260907.131.1';
  try {
    await writeLock(
      {
        ...locked,
        imageVersion: IMAGE,
        tools: { 'Node.js': { versions: ['22.23.2'], source: 'probe' } },
      },
      lockFile,
    );
    const { env = {}, ...rest } = opts;
    return await guard(
      { tools: 'node', 'lock-file': lockFile, 'update-lock': false, ...rest },
      { ImageVersion: IMAGE, ImageOS: 'ubuntu26', ...env },
      now,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('drift caused by the migration is named as such, not left unexplained', async () => {
  const r = await guardAcrossTheMove({ 'fail-on-migration': '30' }, DURING);
  assert.equal(r.code, EXIT_OK, 'a completed migration is not a failure');
  assert.match(
    r.stdout,
    /Explained by the scheduled ubuntu-latest migration ubuntu-24\.04 -> ubuntu-26\.04/,
  );
  assert.match(r.stdout, /\(2026-10-19 to 2026-11-19\)/);
  assert.match(r.stdout, /Node\.js 22\.23\.2 -> /);
  assert.equal(r.stderr, '');
});

test('the explanation needs no flag: the two labels alone identify the move', async () => {
  const r = await guardAcrossTheMove({}, DURING);
  assert.equal(r.code, EXIT_OK);
  assert.match(
    r.stdout,
    /Explained by the scheduled ubuntu-latest migration ubuntu-24\.04 -> ubuntu-26\.04/,
  );
  // Without --fail-on-migration the lane itself stays quiet: no window, no diff.
  assert.ok(!r.stdout.includes('rollout'), 'no migration report without the flag');
  assert.equal(r.stderr, '');
});

test('a repo that pins its runners is not told GitHub moved it', async () => {
  // The same 24.04 -> 26.04 jump, in a repo whose workflows never say
  // ubuntu-latest: someone bumped the pin by hand and owns the upgrade.
  const r = await guardAcrossTheMove({ workflows: path.join(FIXTURES, 'workflows') }, DURING);
  assert.ok(!r.stdout.includes('Explained by'), 'no floating label, no migration to blame');
  assert.match(r.stdout, /Node\.js 22\.23\.2 -> /, 'the drift is still reported');
});

test('the explanation follows the job, not the repo, when Actions says which job', async () => {
  const mine = await guardAcrossTheMove({ env: inJob('build') }, DURING);
  assert.match(mine.stdout, /Explained by the scheduled ubuntu-latest migration/);
  const theirs = await guardAcrossTheMove({ env: inJob('pinned') }, DURING);
  assert.ok(!theirs.stdout.includes('Explained by'), 'the pinned job was not moved by the window');
});

test('a jump the migration table does not describe is left unexplained', async () => {
  const r = await guardAcrossTheMove({}, DURING, {
    label: 'ubuntu-22.04',
    imageOS: 'ubuntu22',
  });
  assert.ok(!r.stdout.includes('Explained by'), 'no announced move goes 22.04 -> 26.04');
});

test('migrationBetween matches only the announced pair', async () => {
  assert.equal(migrationBetween('ubuntu-24.04', 'ubuntu-26.04').label, 'ubuntu-latest');
  assert.equal(migrationBetween('ubuntu-26.04', 'ubuntu-24.04'), null, 'not backwards');
  assert.equal(migrationBetween('ubuntu-22.04', 'ubuntu-26.04'), null);
});
