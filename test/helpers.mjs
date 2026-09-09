import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest } from '../src/manifest.mjs';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Real manifest snapshots downloaded from actions/runner-images. */
export const SNAPSHOTS = {
  'ubuntu-22.04': 'Ubuntu2204-Readme-20260720.234.2.md',
  'ubuntu-22.04@old': 'Ubuntu2204-Readme-20260623.199.1.md',
  'ubuntu-24.04': 'Ubuntu2404-Readme-20260720.247.2.md',
  'macos-15': 'macos-15-Readme-20260720.0353.1.md',
};

export async function readFixture(key) {
  const name = SNAPSHOTS[key] ?? key;
  return readFile(path.join(FIXTURES, name), 'utf8');
}

export async function loadFixtureManifest(label) {
  if (!SNAPSHOTS[label]) {
    return { skipped: true, label, reason: `no fixture for ${label}` };
  }
  const text = await readFixture(label);
  return { ...parseManifest(text, label), skipped: false, url: `fixture:${label}`, ref: 'fixture' };
}

const RUNNER_FIXTURES = path.join(FIXTURES, 'runners');

/** Recorded live responses from the runner-deprecations endpoint. */
export async function readRunnerFixtures() {
  const [recorded, fleets, releases] = await Promise.all(
    ['deprecations-recorded.json', 'fleets.json', 'runner-releases-recorded.json'].map(async (f) =>
      JSON.parse(await readFile(path.join(RUNNER_FIXTURES, f), 'utf8')),
    ),
  );
  return { recorded, fleets, releases };
}

/**
 * Stub `globalThis.fetch` from a url -> {status, body} table, so runners.mjs is
 * exercised through the real http.mjs (rate-limit, 403 and 404 handling
 * included) rather than around it.
 *
 * @param {(url:string) => {status:number, body:unknown, headers?:object}|null} route
 * @returns {{restore:() => void, calls:string[]}}
 */
export function stubApi(route) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const hit = route(u);
    if (!hit) throw new TypeError(`fetch failed (no stub route for ${u})`);
    const headers = { 'x-ratelimit-remaining': '4999', ...(hit.headers ?? {}) };
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      text: async () => (typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body)),
    };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = real;
    },
  };
}

/**
 * The routing table the runner tests share: a fleet listing for `scopePath`,
 * the recorded deprecations responses, and actions/runner's release list.
 */
export function runnerRoutes({ scopePath, fleet, recorded, releases, listing = null }) {
  return (url) => {
    if (url.startsWith(`https://api.github.com${scopePath}/actions/runners/deprecations/`)) {
      const version = decodeURIComponent(url.split('/deprecations/')[1]);
      const hit = recorded.responses[version];
      return hit ?? { status: 404, body: { message: 'Not Found', status: '404' } };
    }
    if (url.startsWith(`https://api.github.com${scopePath}/actions/runners?`)) {
      return listing ?? { status: 200, body: fleet };
    }
    if (url.startsWith('https://api.github.com/repos/actions/runner/releases')) {
      return { status: 200, body: releases.releases };
    }
    return null;
  };
}

/** Capture stdout/stderr from a command function. */
export function captureIO() {
  const outChunks = [];
  const errChunks = [];
  return {
    io: {
      stdout: { write: (s) => outChunks.push(s) },
      stderr: { write: (s) => errChunks.push(s) },
    },
    get stdout() {
      return outChunks.join('');
    },
    get stderr() {
      return errChunks.join('');
    },
  };
}
