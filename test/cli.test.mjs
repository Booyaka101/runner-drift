import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { main, EXIT_OK, EXIT_USAGE } from '../src/cli.mjs';
import { captureIO } from './helpers.mjs';

async function run(argv) {
  const cap = captureIO();
  const code = await main(argv, cap.io);
  return { code, stdout: cap.stdout, stderr: cap.stderr };
}

test('--help prints usage and exits 0', async () => {
  const r = await run(['--help']);
  assert.equal(r.code, EXIT_OK);
  assert.match(r.stdout, /runner-drift init/);
  assert.match(r.stdout, /runner-drift guard/);
  assert.match(r.stdout, /runner-drift plan/);
  assert.match(r.stdout, /Known labels: ubuntu-22\.04/);
});

test('--version prints the version from package.json', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const r = await run(['--version']);
  assert.equal(r.code, EXIT_OK);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('no command prints usage to stderr and exits 2', async () => {
  const r = await run([]);
  assert.equal(r.code, EXIT_USAGE);
  assert.match(r.stderr, /Usage:/);
});

test('an unknown command is named', async () => {
  const r = await run(['frobnicate']);
  assert.equal(r.code, EXIT_USAGE);
  assert.match(r.stderr, /Unknown command "frobnicate"/);
});

test('an unknown flag is a usage error, not a crash', async () => {
  const r = await run(['plan', '--nope']);
  assert.equal(r.code, EXIT_USAGE);
  assert.match(r.stderr, /Unknown option '--nope'/);
});

test('guard on a machine with no ImageVersion skips cleanly through main()', async () => {
  const saved = process.env.ImageVersion;
  delete process.env.ImageVersion;
  try {
    const r = await run(['guard', '--tools', 'node']);
    assert.equal(r.code, EXIT_OK);
    assert.match(r.stdout, /not a GitHub-hosted runner/);
  } finally {
    if (saved !== undefined) process.env.ImageVersion = saved;
  }
});
