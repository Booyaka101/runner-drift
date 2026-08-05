import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  analyseWorkflow,
  extractLabels,
  extractRunScripts,
  commandsInScript,
  detect,
  SELF_HOSTED,
} from '../src/detect.mjs';
import { canonicalTool } from '../src/tools.mjs';
import { FIXTURES } from './helpers.mjs';

test('extracts an inline runs-on label', () => {
  assert.deepEqual(extractLabels('jobs:\n  a:\n    runs-on: ubuntu-22.04\n'), ['ubuntu-22.04']);
});

test('extracts a flow-sequence runs-on', () => {
  assert.deepEqual(
    extractLabels('    runs-on: [self-hosted, linux, x64]\n').sort(),
    ['linux', 'self-hosted', 'x64'],
  );
});

test('extracts a block-sequence runs-on', () => {
  const y = 'jobs:\n  a:\n    runs-on:\n      - self-hosted\n      - linux\n    steps: []\n';
  assert.deepEqual(extractLabels(y).sort(), ['linux', 'self-hosted']);
});

test('resolves runs-on: ${{ matrix.os }} from the matrix values in the same file', () => {
  const y = [
    'jobs:',
    '  a:',
    '    strategy:',
    '      matrix:',
    '        os: [ubuntu-22.04, ubuntu-24.04, macos-15]',
    '    runs-on: ${{ matrix.os }}',
  ].join('\n');
  assert.deepEqual(extractLabels(y).sort(), ['macos-15', 'ubuntu-22.04', 'ubuntu-24.04']);
});

test('extracts single-line and block run scripts', () => {
  const y = [
    'steps:',
    '  - run: python -m pip install -r requirements.txt',
    '  - name: build',
    '    run: |',
    '      cmake -S . -B build',
    '      cmake --build build',
    '  - uses: actions/checkout@v4',
  ].join('\n');
  const scripts = extractRunScripts(y);
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0], 'python -m pip install -r requirements.txt');
  assert.match(scripts[1], /cmake --build build/);
});

test('finds commands past sudo, env assignments and pipes', () => {
  const cmds = commandsInScript(
    'sudo docker build . && CC=clang cmake -S . -B out\ngit rev-parse HEAD | head -1',
  );
  assert.deepEqual(cmds.sort(), ['cmake', 'docker', 'git']);
});

test('maps commands to the canonical manifest tool', () => {
  assert.equal(canonicalTool('python3'), 'Python');
  assert.equal(canonicalTool('npx'), 'Node.js');
  assert.equal(canonicalTool('clang++'), 'Clang');
  assert.equal(canonicalTool('g++'), 'GNU C++');
  assert.equal(canonicalTool('javac'), 'Temurin');
  assert.equal(canonicalTool('dotnet'), '.NET Core SDK');
});

test('actions/setup-* counts as using the tool', () => {
  const r = analyseWorkflow(
    'jobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/setup-go@v5\n',
  );
  assert.deepEqual(r.tools, ['Go']);
});

test('scans a real workflow directory', async () => {
  const d = await detect(path.join(FIXTURES, 'workflows'));
  assert.equal(d.missing, false);
  assert.equal(d.files.length, 2);
  assert.deepEqual(d.tools, ['CMake', 'Clang', 'Python']);
  assert.ok(d.labels.includes('ubuntu-22.04'));
  assert.ok(d.labels.includes(SELF_HOSTED));
});

test('a single workflow file works as well as a directory', async () => {
  const d = await detect(path.join(FIXTURES, 'workflows', 'build.yml'));
  assert.deepEqual(d.files.length, 1);
  assert.deepEqual(d.tools, ['CMake', 'Clang', 'Python']);
});

test('a missing directory is reported, not thrown', async () => {
  const d = await detect(path.join(FIXTURES, 'definitely-not-here'));
  assert.equal(d.missing, true);
  assert.deepEqual(d.tools, []);
});

test('an empty or non-workflow document yields nothing', () => {
  const r = analyseWorkflow('');
  assert.deepEqual(r.labels, []);
  assert.deepEqual(r.tools, []);
});
