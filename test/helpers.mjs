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
