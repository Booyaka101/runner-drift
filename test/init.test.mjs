/**
 * `init` resolves the runner label offline here; the manifest fetch it would do
 * next is exercised live in the acceptance run and by the plan golden test, so
 * these cases stop at the label/tool decision, which is where the edge cases are.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { runInit, EXIT_OK, EXIT_USAGE } from '../src/cli.mjs';
import { captureIO, FIXTURES } from './helpers.mjs';

async function repo(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'runner-drift-init-'));
  const wf = path.join(dir, '.github', 'workflows');
  await mkdir(wf, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(wf, name), body, 'utf8');
  }
  return { dir, workflows: wf };
}

async function init(opts) {
  const cap = captureIO();
  const code = await runInit(opts, cap.io);
  return { code, stdout: cap.stdout, stderr: cap.stderr };
}

test('a self-hosted-only repo is a clean skip, exit 0', async () => {
  const r = await init({
    workflows: path.join(FIXTURES, 'workflows', 'selfhosted.yml'),
    'lock-file': path.join(os.tmpdir(), 'runner-drift-should-not-exist.json'),
  });
  assert.equal(r.code, EXIT_OK);
  assert.match(r.stdout, /Only self-hosted runners found/);
  assert.match(r.stdout, /Skipping/);
});

test('extra self-hosted tags (gpu, linux) are not mistaken for image labels', async () => {
  const { dir, workflows } = await repo({
    'a.yml': 'jobs:\n  a:\n    runs-on: [self-hosted, linux, gpu, x64]\n    steps:\n      - run: python x.py\n',
  });
  try {
    const r = await init({ workflows, 'lock-file': path.join(dir, 'runner-lock.json') });
    assert.equal(r.code, EXIT_OK);
    assert.match(r.stdout, /Only self-hosted runners found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unknown but image-shaped label is named, not silently dropped', async () => {
  const { dir, workflows } = await repo({
    'a.yml': 'jobs:\n  a:\n    runs-on: ubuntu-18.04\n    steps:\n      - run: python x.py\n',
  });
  try {
    const r = await init({ workflows, 'lock-file': path.join(dir, 'runner-lock.json') });
    assert.equal(r.code, EXIT_USAGE);
    assert.match(r.stderr, /Unknown runner label "ubuntu-18\.04"/);
    assert.match(r.stderr, /Known labels:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a floating label is refused with the two ways forward', async () => {
  const { dir, workflows } = await repo({
    'a.yml': 'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: python x.py\n',
  });
  try {
    const r = await init({ workflows, 'lock-file': path.join(dir, 'runner-lock.json') });
    assert.equal(r.code, EXIT_USAGE);
    assert.match(r.stderr, /floating label\(s\) ubuntu-latest/);
    assert.match(r.stderr, /--label ubuntu-24\.04/);
    assert.match(r.stderr, /guard.* reads the real/s);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('two different image labels need an explicit --label', async () => {
  const { dir, workflows } = await repo({
    'a.yml': 'jobs:\n  a:\n    runs-on: ubuntu-22.04\n    steps:\n      - run: python x.py\n',
    'b.yml': 'jobs:\n  b:\n    runs-on: macos-15\n    steps:\n      - run: python y.py\n',
  });
  try {
    const r = await init({ workflows, 'lock-file': path.join(dir, 'runner-lock.json') });
    assert.equal(r.code, EXIT_USAGE);
    assert.match(r.stderr, /Multiple runner labels found: macos-15, ubuntu-22\.04/);
    assert.match(r.stderr, /--label <label>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('zero detected tools tells the user to pass --tools', async () => {
  const { dir, workflows } = await repo({
    'a.yml': 'jobs:\n  a:\n    runs-on: ubuntu-22.04\n    steps:\n      - run: echo hi\n',
  });
  try {
    const r = await init({ workflows, 'lock-file': path.join(dir, 'runner-lock.json') });
    assert.equal(r.code, EXIT_USAGE);
    assert.match(r.stderr, /No known tools detected/);
    assert.match(r.stderr, /--tools python,cmake,clang/);
    assert.match(r.stderr, /Recognised tools:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a missing workflow directory is a clear message', async () => {
  const r = await init({ workflows: path.join(os.tmpdir(), 'runner-drift-nope-'.concat('x')) });
  assert.equal(r.code, EXIT_USAGE);
  assert.match(r.stderr, /No workflow directory/);
  assert.match(r.stderr, /--workflows <path> or --tools/);
});
