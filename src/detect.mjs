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

/**
 * Collect the raw text of every `run:` step in a workflow document.
 *
 * Same linear-time shape as scanRunsOn below, for the same reason. CodeQL did
 * not flag this one, but it was the identical `\s*(.*)$` pattern.
 */
export function extractRunScripts(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const scripts = [];
  for (let i = 0; i < lines.length; i++) {
    // The dash has to be inside the optional group, not beside it. `[ \t]*-?[ \t]*`
    // is two runs over the same class with nothing mandatory between them, so on
    // a long indent that never reaches `run:` the engine tries every way to split
    // the spaces. Requiring the `-` inside the group removes the ambiguity.
    const m = lines[i].match(/^[ \t]*(?:-[ \t]*)?run:[ \t]*([^\r\n]*)/);
    if (!m) continue;
    const baseIndent = indentOf(lines[i]);
    const inline = m[1].trim();
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

/** 1-indexed column of the label inside a raw scalar that may be padded or quoted. */
function labelColumn(start, raw) {
  const lead = raw.length - raw.trimStart().length;
  return start + lead + (/^['"]/.test(raw.trim()) ? 1 : 0) + 1;
}

/**
 * Every `runs-on:` value in a document, positioned. `expression` reports
 * whether any value was a `${{ … }}` reference, which is what makes the
 * matrix fallback below kick in.
 *
 * Two shapes here are load-bearing for linear time, and both were quadratic
 * before 1.2.0 (CodeQL js/polynomial-redos). Indentation is `[ \t]`, not `\s`,
 * and the value is `([^\r\n]*)` with no `$`. The pair matters: `\s*(.*)$` lets
 * both quantifiers match a space, and `$` can fail because `.` excludes line
 * terminators, so one stray carriage return on a long line makes the engine try
 * every split of the whitespace between them. Without a `$` there is nothing to
 * fail, so nothing to backtrack. For a line with no terminator in it — which is
 * every line, since the caller split on newlines — both captures are unchanged.
 */
function scanRunsOn(lines) {
  const found = [];
  // `found` is flat, one entry per label, because the retirement lane annotates
  // each pinned label where it sits. `targets` keeps the labels of one `runs-on:`
  // together, which is what decides whether a given runner can take the job:
  // GitHub only schedules onto a runner carrying every label in the set.
  const targets = [];
  let target = null;
  let expression = false;
  const push = (raw, line, col) => {
    const label = normaliseLabel(raw);
    if (!label) return;
    found.push({ label, line, col });
    target?.labels.push(label);
  };

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([ \t]*)runs-on:[ \t]*([^\r\n]*)/);
    if (!m) continue;
    const baseIndent = m[1].length;
    const value = m[2].trim();
    const valueStart = lines[i].length - m[2].length;

    // Anchored on the `runs-on:` line itself: the set is the target, so pointing
    // at one item of a block list would be arbitrary.
    target = { labels: [], expression: false, line: i + 1, col: valueStart + 1 };
    targets.push(target);

    if (!value) {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '') continue;
        if (indentOf(l) <= baseIndent) break;
        const dash = l.match(/^([ \t]*-[ \t]*)([^\r\n]*)/);
        const item = dash ? dash[2] : l.trim();
        if (item.includes('${{')) expression = target.expression = true;
        else push(item, j + 1, labelColumn(dash ? dash[1].length : indentOf(l), item));
        i = j;
      }
    } else if (value.startsWith('[')) {
      let offset = valueStart + lines[i].slice(valueStart).indexOf('[') + 1;
      for (const part of value.replace(/^\[|\]$/g, '').split(',')) {
        if (part.includes('${{')) expression = target.expression = true;
        else push(part, i + 1, labelColumn(offset, part));
        offset += part.length + 1;
      }
    } else if (value.includes('${{')) {
      expression = target.expression = true;
    } else {
      push(value, i + 1, labelColumn(valueStart, m[2]));
    }
  }
  return { found, targets, expression };
}

/** `runs-on: ${{ matrix.os }}` -> the label-shaped scalars elsewhere in the file. */
function matrixLabels(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    for (const tok of lines[i].matchAll(/[A-Za-z][A-Za-z0-9.-]*/g)) {
      if (LABEL_SHAPE.test(tok[0])) {
        found.push({ label: tok[0].toLowerCase(), line: i + 1, col: tok.index + 1 });
      }
    }
  }
  return found;
}

/** Pull `runs-on:` labels (inline scalar, inline flow list, block list, matrix refs). */
export function extractLabels(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const { found, expression } = scanRunsOn(lines);
  const labels = new Set(found.map((f) => f.label));
  if (expression) {
    for (const { label } of matrixLabels(lines)) labels.add(label);
    for (const line of lines) {
      if (/(^|\s)self-hosted(\s|$|,|\]|')/.test(line) && /runs-on|matrix|os:|- /.test(line)) {
        labels.add(SELF_HOSTED);
      }
    }
  }
  return [...labels];
}

/**
 * Where each `runs-on` label sits: `{label, file, line, col}` per occurrence,
 * 1-indexed, `col` on the label text so a `file=,line=,col=` annotation lands
 * on it. Self-hosted and floating labels are skipped, having no fixed date to
 * retire on.
 */
export function extractLabelSites(text, file = null) {
  const lines = String(text ?? '').split(/\r?\n/);
  const { found, expression } = scanRunsOn(lines);
  const seen = new Set();
  const sites = [];
  for (const { label, line, col } of expression ? [...found, ...matrixLabels(lines)] : found) {
    if (label === SELF_HOSTED || isFloating(label)) continue;
    const key = `${label}@${line}:${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sites.push({ label, file, line, col });
  }
  return sites;
}

/**
 * One entry per `runs-on:`, with its label SET intact: `{labels, file, line, col}`.
 *
 * This is the shape the self-hosted lane needs, because GitHub schedules a job
 * onto a runner only if that runner carries every label in the set. Targets
 * whose value is a `${{ … }}` expression are reported with `expression: true`
 * and no labels, since which runner serves them is not decidable from the file.
 */
export function extractRunsOnTargets(text, file = null) {
  const lines = String(text ?? '').split(/\r?\n/);
  const { targets } = scanRunsOn(lines);
  return targets.map((t) => ({
    labels: [...new Set(t.labels)],
    expression: t.expression,
    file,
    line: t.line,
    col: t.col,
  }));
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
  const runsOnTargets = extractRunsOnTargets(text, file);
  const commands = new Set();
  for (const script of extractRunScripts(text)) {
    for (const c of commandsInScript(script)) commands.add(c);
  }
  const tools = new Set([...commands].map((c) => canonicalTool(c)));
  for (const t of extractSetupActions(text)) tools.add(t);
  return { file, labels, labelSites, runsOnTargets, commands: [...commands].sort(), tools: [...tools].sort() };
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
      return {
        dir: target,
        files: [],
        labels: [],
        labelSites: [],
        runsOnTargets: [],
        tools: [],
        perFile: [],
        missing: true,
      };
    }
  }

  const perFile = [];
  const labels = new Set();
  const labelSites = [];
  const runsOnTargets = [];
  const tools = new Set();
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    const r = analyseWorkflow(text, f);
    perFile.push(r);
    for (const l of r.labels) labels.add(l);
    labelSites.push(...r.labelSites);
    runsOnTargets.push(...r.runsOnTargets);
    for (const t of r.tools) tools.add(t);
  }

  return {
    dir: target,
    files,
    labels: [...labels].sort(),
    labelSites,
    runsOnTargets,
    tools: [...tools].sort(),
    perFile,
    missing: false,
  };
}
