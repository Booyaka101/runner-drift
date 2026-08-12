/**
 * Workflow scanning: .github/workflows/*.y[a]ml -> { labels[], tools[] }.
 *
 * Deliberately a targeted line scanner rather than a full YAML parse — this
 * package has zero runtime dependencies, and the two constructs it needs
 * (`runs-on:` values and `run:` block scalars) are unambiguous at line level.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { COMMAND_ALIASES, SETUP_ACTION_ALIASES, canonicalTool } from './tools.mjs';
import { isFloating, normaliseLabel } from './labels.mjs';

const WORKFLOW_EXT = /\.ya?ml$/i;
const LABEL_SHAPE = /^(ubuntu|windows|macos)-[a-z0-9.-]+$/i;

export const SELF_HOSTED = 'self-hosted';

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/** Collect the raw text of every `run:` step in a workflow document. */
export function extractRunScripts(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const scripts = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-?\s*run:\s*(.*)$/);
    if (!m) continue;
    const baseIndent = indentOf(lines[i]);
    const inline = m[2].trim();
    if (inline && !/^[|>][-+0-9]*$/.test(inline)) {
      scripts.push(inline.replace(/^['"]|['"]$/g, ''));
      continue;
    }
    const block = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') {
        block.push('');
        continue;
      }
      if (indentOf(l) <= baseIndent) break;
      block.push(l.trim());
      i = j;
    }
    if (block.length) scripts.push(block.join('\n'));
  }
  return scripts;
}

/** Pull invoked command names out of a shell script body. */
export function commandsInScript(script) {
  const found = new Set();
  const statements = String(script ?? '')
    .split(/\r?\n|&&|\|\||[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    let s = stmt.replace(/^[-@(]+\s*/, '');
    // Drop leading env assignments and privilege wrappers.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const next = s.replace(/^(?:sudo(?:\s+-[^\s]+)*|env|time|xargs|[A-Za-z_][A-Za-z0-9_]*=\S*)\s+/, '');
      if (next === s) break;
      s = next;
    }
    const token = s.split(/\s+/)[0];
    if (!token) continue;
    const base = token.split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '');
    if (COMMAND_ALIASES[base.toLowerCase()]) found.add(base.toLowerCase());
  }
  return [...found];
}

/** Pull `runs-on:` labels (inline scalar, inline flow list, block list, matrix refs). */
export function extractLabels(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const labels = new Set();
  const expressions = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)runs-on:\s*(.*)$/);
    if (!m) continue;
    const baseIndent = m[1].length;
    let value = m[2].trim();

    if (!value) {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '') continue;
        if (indentOf(l) <= baseIndent) break;
        const item = l.trim().replace(/^-\s*/, '');
        if (item.includes('${{')) expressions.push(item);
        else {
          const n = normaliseLabel(item);
          if (n) labels.add(n);
        }
        i = j;
      }
      continue;
    }

    if (value.startsWith('[')) {
      for (const part of value.replace(/^\[|\]$/g, '').split(',')) {
        if (part.includes('${{')) expressions.push(part.trim());
        else {
          const n = normaliseLabel(part);
          if (n) labels.add(n);
        }
      }
      continue;
    }

    if (value.includes('${{')) {
      expressions.push(value);
      continue;
    }
    const n = normaliseLabel(value);
    if (n) labels.add(n);
  }

  // `runs-on: ${{ matrix.os }}` -> harvest label-shaped scalars from the file.
  if (expressions.length) {
    for (const line of lines) {
      for (const tok of line.match(/[A-Za-z][A-Za-z0-9.-]*/g) ?? []) {
        if (LABEL_SHAPE.test(tok)) labels.add(tok.toLowerCase());
      }
      if (/(^|\s)self-hosted(\s|$|,|\]|')/.test(line) && /runs-on|matrix|os:|- /.test(line)) {
        labels.add(SELF_HOSTED);
      }
    }
  }

  return [...labels];
}

/**
 * Where each `runs-on` label sits in the file: {label, file, line, col},
 * line and col both 1-indexed, col pointing at the label text itself so
 * `::error file=,line=,col=` annotations land on it. Self-hosted and
 * floating labels get no site — there is nothing to retire at a fixed date.
 * For `${{ matrix.os }}` the sites are the label-shaped scalars in the file.
 */
export function extractLabelSites(text, file = null) {
  const lines = String(text ?? '').split(/\r?\n/);
  const sites = [];
  const seen = new Set();
  let hasExpression = false;

  const add = (rawItem, lineNo, col) => {
    const label = normaliseLabel(rawItem);
    if (!label || label === SELF_HOSTED || isFloating(label)) return;
    const key = `${label}@${lineNo}:${col}`;
    if (seen.has(key)) return;
    seen.add(key);
    sites.push({ label, file, line: lineNo, col });
  };

  // Column of the label text within a raw scalar that may be quoted.
  const colOf = (line, start, raw) => {
    const lead = raw.length - raw.trimStart().length;
    const quoted = /^['"]/.test(raw.trim());
    return start + lead + (quoted ? 1 : 0) + 1;
  };

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)runs-on:\s*(.*)$/);
    if (!m) continue;
    const baseIndent = m[1].length;
    const value = m[2].trim();
    const valueStart = lines[i].length - m[2].length;

    if (!value) {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '') continue;
        if (indentOf(l) <= baseIndent) break;
        const itemMatch = l.match(/^(\s*-\s*)(.*)$/);
        const item = itemMatch ? itemMatch[2] : l.trim();
        if (item.includes('${{')) hasExpression = true;
        else add(item, j + 1, colOf(l, itemMatch ? itemMatch[1].length : indentOf(l), item));
        i = j;
      }
      continue;
    }

    if (value.startsWith('[')) {
      let offset = valueStart + lines[i].slice(valueStart).indexOf('[') + 1;
      for (const part of value.replace(/^\[|\]$/g, '').split(',')) {
        if (part.includes('${{')) hasExpression = true;
        else add(part, i + 1, colOf(lines[i], offset, part));
        offset += part.length + 1;
      }
      continue;
    }

    if (value.includes('${{')) {
      hasExpression = true;
      continue;
    }
    add(value, i + 1, colOf(lines[i], valueStart, m[2]));
  }

  if (hasExpression) {
    for (let i = 0; i < lines.length; i++) {
      for (const tok of lines[i].matchAll(/[A-Za-z][A-Za-z0-9.-]*/g)) {
        if (LABEL_SHAPE.test(tok[0])) add(tok[0], i + 1, tok.index + 1);
      }
    }
  }

  return sites;
}

/** `uses: actions/setup-node@v5` -> Node.js (any version suffix; only the owner/repo matters) */
export function extractSetupActions(text) {
  const tools = new Set();
  for (const m of String(text ?? '').matchAll(/uses:\s*['"]?([\w.-]+\/[\w.-]+)/g)) {
    const tool = SETUP_ACTION_ALIASES[m[1].toLowerCase()];
    if (tool) tools.add(tool);
  }
  return [...tools];
}

/** Analyse one workflow document. */
export function analyseWorkflow(text, file = null) {
  const labels = extractLabels(text);
  const labelSites = extractLabelSites(text, file);
  const commands = new Set();
  for (const script of extractRunScripts(text)) {
    for (const c of commandsInScript(script)) commands.add(c);
  }
  const tools = new Set([...commands].map((c) => canonicalTool(c)));
  for (const t of extractSetupActions(text)) tools.add(t);
  return { file, labels, labelSites, commands: [...commands].sort(), tools: [...tools].sort() };
}

async function listWorkflowFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return entries
    .filter((e) => e.isFile() && WORKFLOW_EXT.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();
}

/**
 * Scan a directory of workflows (or a single workflow file).
 * @returns {{dir:string, files:string[], labels:string[], labelSites:object[],
 *            tools:string[], perFile:object[], missing:boolean}}
 */
export async function detect(workflowsPath) {
  const target = workflowsPath || path.join('.github', 'workflows');
  let files;
  let s = null;
  try {
    s = await stat(target);
  } catch {
    s = null;
  }
  if (s?.isFile()) {
    files = [target];
  } else {
    files = await listWorkflowFiles(target);
    if (files === null) {
      return { dir: target, files: [], labels: [], labelSites: [], tools: [], perFile: [], missing: true };
    }
  }

  const perFile = [];
  const labels = new Set();
  const labelSites = [];
  const tools = new Set();
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    const r = analyseWorkflow(text, f);
    perFile.push(r);
    for (const l of r.labels) labels.add(l);
    labelSites.push(...r.labelSites);
    for (const t of r.tools) tools.add(t);
  }

  return {
    dir: target,
    files,
    labels: [...labels].sort(),
    labelSites,
    tools: [...tools].sort(),
    perFile,
    missing: false,
  };
}
