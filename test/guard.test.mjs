import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { runGuard, EXIT_OK, EXIT_DRIFT, EXIT_USAGE } from '../src/cli.mjs';
import { readLock, writeLock, SCHEMA_VERSION } from '../src/lock.mjs';
import { captureIO } from './helpers.mjs';

async function tmp() {
  return mkdtemp(path.join(os.tmpdir(), 'runner-drift-test-'));
}

/**
 * Every guard test below is offline: `--tools node` is probeable, and the lock
 * carries the same ImageVersion as the fake env, so no attribution fetch runs.
 */
const IMAGE = '20260720.234.2';
const ENV = { ImageVersion: IMAGE, ImageOS: 'ubuntu22' };

async function guard(opts, env = ENV) {
  const cap = captureIO();
  const code = await runGuard({ summary: true, 'update-lock': true, ...opts }, cap.io, env);
  return { code, stdout: cap.stdout, stderr: cap.stderr };
}

test('self-hosted / local: no ImageVersion means a clean skip, exit 0', async () => {
  const r = await guard({ tools: 'node' }, {});
  assert.equal(r.code, EXIT_OK);
  assert.match(r.stdout, /No ImageVersion environment variable/);
  assert.match(r.stdout, /::notice title=runner-drift::/);
  assert.match(r.stdout, /skipping/);
});

test('an unknown ImageOS is a warning and a skip, not a crash', async () => {
  const dir = await tmp();
  try {
    const r = await guard(
      { tools: 'node', 'lock-file': path.join(dir, 'runner-lock.json'), workflows: path.join(dir, 'none') },
      { ImageVersion: IMAGE, ImageOS: 'plan9' },
    );
    assert.equal(r.code, EXIT_OK);
    assert.match(r.stdout, /Unknown runner label/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('first run with no lock creates one and exits 0 with "baseline recorded"', async () => {
  const dir = await tmp();
  const lockFile = path.join(dir, 'runner-lock.json');
  try {
    const r = await guard({ tools: 'node', 'lock-file': lockFile });
    assert.equal(r.code, EXIT_OK);
    assert.match(r.stdout, /baseline recorded/);

    const lock = await readLock(lockFile);
    assert.equal(lock.schemaVersion, SCHEMA_VERSION);
    assert.equal(lock.label, 'ubuntu-22.04');
    assert.equal(lock.imageVersion, IMAGE);
    assert.equal(lock.tools['Node.js'].source, 'probe');
    assert.equal(lock.tools['Node.js'].versions[0], process.versions.node);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('no drift on a second run against the same image', async () => {
  const dir = await tmp();
  const lockFile = path.join(dir, 'runner-lock.json');
  try {
    await guard({ tools: 'node', 'lock-file': lockFile });
    const r = await guard({ tools: 'node', 'lock-file': lockFile });
    assert.equal(r.code, EXIT_OK);
    assert.match(r.stdout, /No drift/);
    assert.ok(!r.stdout.includes('::warning'), 'no annotations when nothing changed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('drift is reported with a ::warning and exits 0 by default', async () => {
  const dir = await tmp();
  const lockFile = path.join(dir, 'runner-lock.json');
  try {
    await writeLock(
      {
        label: 'ubuntu-22.04',
        imageOS: 'ubuntu22',
        imageVersion: IMAGE,
        tools: { 'Node.js': { versions: ['18.0.0'], source: 'probe' } },
      },
      lockFile,
    );
    const r = await guard({ tools: 'node', 'lock-file': lockFile });
    assert.equal(r.code, EXIT_OK, 'exit 0 by default');
    assert.match(r.stdout, /::warning title=runner-drift: Node\.js major::/);
    assert.match(r.stdout, /Node\.js 18\.0\.0 -> /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('exit code 1 only under --fail-on major (and above)', async () => {
  const dir = await tmp();
  const lockFile = path.join(dir, 'runner-lock.json');
  const seed = () =>
    writeLock(
      {
        label: 'ubuntu-22.04',
        imageOS: 'ubuntu22',
        imageVersion: IMAGE,
        tools: { 'Node.js': { versions: ['18.0.0'], source: 'probe' } },
      },
      lockFile,
    );
  try {
    await seed();
    assert.equal((await guard({ tools: 'node', 'lock-file': lockFile })).code, EXIT_OK);

    await seed();
    const major = await guard({ tools: 'node', 'lock-file': lockFile, 'fail-on': 'major' });
    assert.equal(major.code, EXIT_DRIFT);
    assert.match(major.stderr, /MAJOR drift detected/);

    await seed();
    assert.equal((await guard({ tools: 'node', 'lock-file': lockFile, 'fail-on': 'any' })).code, EXIT_DRIFT);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a PATCH-only drift does not trip --fail-on major', async () => {
  const dir = await tmp();
  const lockFile = path.join(dir, 'runner-lock.json');
  try {
    const [maj, min, pat] = process.versions.node.split('.');
    const older = `${maj}.${min}.${Number(pat) + 1}`; // differs only in the patch field
    await writeLock(
      {
        label: 'ubuntu-22.04',
        imageOS: 'ubuntu22',
        imageVersion: IMAGE,
        tools: { 'Node.js': { versions: [older], source: 'probe' } },
      },
      lockFile,
    );
    const r = await guard({ tools: 'node', 'lock-file': lockFile, 'fail-on': 'major' });
    assert.equal(r.code, EXIT_OK);
    assert.match(r.stdout, /PATCH/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an invalid --fail-on value is a usage error', async () => {
  const r = await guard({ tools: 'node', 'fail-on': 'catastrophic' });
  assert.equal(r.code, EXIT_USAGE);
  assert.match(r.stderr, /--fail-on must be one of/);
});

test('zero tools and no lock tells the user to pass --tools', async () => {
  const dir = await tmp();
  try {
    const r = await guard({
      'lock-file': path.join(dir, 'runner-lock.json'),
      workflows: path.join(dir, 'no-workflows'),
    });
    assert.equal(r.code, EXIT_USAGE);
    assert.match(r.stderr, /--tools python,cmake,clang/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('guard writes a markdown table to $GITHUB_STEP_SUMMARY', async () => {
  const dir = await tmp();
  const lockFile = path.join(dir, 'runner-lock.json');
  const summaryFile = path.join(dir, 'summary.md');
  await writeFile(summaryFile, '', 'utf8');
  const prev = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = summaryFile;
  try {
    await writeLock(
      {
        label: 'ubuntu-22.04',
        imageOS: 'ubuntu22',
        imageVersion: IMAGE,
        tools: { 'Node.js': { versions: ['18.0.0'], source: 'probe' } },
      },
      lockFile,
    );
    await guard({ tools: 'node', 'lock-file': lockFile });
    const md = await readFile(summaryFile, 'utf8');
    assert.match(md, /## runner-drift/);
    assert.match(md, /\| Tool \| Locked \| Now \| Change \| Shipped by \|/);
    assert.match(md, /\| `Node\.js` \| 18\.0\.0 \|/);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test('--no-update-lock leaves the lock alone', async () => {
  const dir = await tmp();
  const lockFile = path.join(dir, 'runner-lock.json');
  try {
    await writeLock(
      {
        label: 'ubuntu-22.04',
        imageOS: 'ubuntu22',
        imageVersion: '20260101.1.1',
        tools: { 'Node.js': { versions: ['18.0.0'], source: 'probe' } },
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      lockFile,
    );
    await guard({ tools: 'node', 'lock-file': lockFile, 'update-lock': false }, { ...ENV, ImageVersion: '20260101.1.1' });
    const lock = await readLock(lockFile);
    assert.equal(lock.updatedAt, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(lock.tools['Node.js'].versions, ['18.0.0']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
