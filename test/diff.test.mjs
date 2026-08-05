import test from 'node:test';
import assert from 'node:assert/strict';
import { diffTool, severityBetween, shouldFail, maxSeverity, compareVersions } from '../src/diff.mjs';

test('classifies single-version changes', () => {
  assert.equal(severityBetween('3.10.12', '3.12.3'), 'minor');
  assert.equal(severityBetween('3.10.12', '4.0.0'), 'major');
  assert.equal(severityBetween('3.10.12', '3.10.14'), 'patch');
  assert.equal(severityBetween('3.10.12', '3.10.12'), 'none');
});

test('Python 3.10.12 -> 3.12.3 is a MINOR change', () => {
  const d = diffTool('Python', ['3.10.12'], ['3.12.3']);
  assert.equal(d.changed, true);
  assert.equal(d.severity, 'minor');
  assert.equal(d.detail, 'MINOR');
});

test('multi-version Clang is a set diff, not a first-element compare', () => {
  const d = diffTool('Clang', ['13.0.1', '14.0.0', '15.0.7'], ['16.0.6', '17.0.6', '18.1.3']);
  assert.equal(d.changed, true);
  assert.equal(d.severity, 'major');
  assert.deepEqual(d.removed, ['13.0.1', '14.0.0', '15.0.7']);
  assert.deepEqual(d.added, ['16.0.6', '17.0.6', '18.1.3']);
  assert.equal(d.detail, 'REMOVED: 13.0.1, 14.0.0, 15.0.7 / ADDED: 16.0.6, 17.0.6, 18.1.3');
});

test('a partially overlapping version set reports only the delta', () => {
  const d = diffTool('Go', ['1.24.13', '1.25.12'], ['1.25.12', '1.26.5']);
  assert.deepEqual(d.removed, ['1.24.13']);
  assert.deepEqual(d.added, ['1.26.5']);
  assert.equal(d.detail, 'REMOVED: 1.24.13 / ADDED: 1.26.5');
});

test('an unchanged tool is marked unchanged so callers can suppress it', () => {
  const d = diffTool('CMake', ['3.31.6'], ['3.31.6']);
  assert.equal(d.changed, false);
  assert.equal(d.kind, 'unchanged');
  assert.equal(d.severity, 'none');
});

test('an unchanged multi-version set is also suppressed regardless of order', () => {
  const d = diffTool('Clang', ['13.0.1', '14.0.0'], ['14.0.0', '13.0.1']);
  assert.equal(d.changed, false);
});

test('added and removed tools are classified', () => {
  assert.equal(diffTool('Podman', null, ['3.4.4']).kind, 'added');
  assert.equal(diffTool('Podman', ['3.4.4'], null).kind, 'removed');
  assert.equal(diffTool('Podman', null, null).changed, false);
});

test('shouldFail honours the --fail-on threshold', () => {
  const minor = [diffTool('Python', ['3.10.12'], ['3.12.3'])];
  const patch = [diffTool('Git', ['2.54.0'], ['2.54.1'])];
  const major = [diffTool('Clang', ['15.0.7'], ['18.1.3'])];
  const none = [diffTool('CMake', ['3.31.6'], ['3.31.6'])];

  assert.equal(shouldFail(minor, 'none'), false);
  assert.equal(shouldFail(minor, 'major'), false);
  assert.equal(shouldFail(minor, 'minor'), true);
  assert.equal(shouldFail(minor, 'any'), true);

  assert.equal(shouldFail(patch, 'minor'), false);
  assert.equal(shouldFail(patch, 'any'), true);

  assert.equal(shouldFail(major, 'major'), true);
  assert.equal(shouldFail(none, 'any'), false);
});

test('maxSeverity ignores unchanged rows', () => {
  const diffs = [
    diffTool('CMake', ['3.31.6'], ['3.31.6']),
    diffTool('Python', ['3.10.12'], ['3.12.3']),
  ];
  assert.equal(maxSeverity(diffs), 'minor');
});

test('compareVersions sorts real manifest version strings', () => {
  assert.deepEqual(['3.31.6', '3.18.1', '4.1.2'].sort(compareVersions), ['3.18.1', '3.31.6', '4.1.2']);
});
