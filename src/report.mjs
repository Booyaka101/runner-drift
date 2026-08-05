/**
 * Output formatting: plain-text plan report, GitHub step-summary markdown,
 * and ::warning workflow annotations.
 */

import { appendFile } from 'node:fs/promises';
import { deadlineFor } from './labels.mjs';

const MS_PER_DAY = 86_400_000;

export function daysUntil(dateStr, now = new Date()) {
  const target = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(target)) return null;
  return Math.round((target - now.getTime()) / MS_PER_DAY);
}

function joinVersions(list) {
  return list.join(',');
}

/** `Python 3.10.12 -> 3.12.3  MINOR` */
export function planRow(d) {
  const from = d.from.length ? joinVersions(d.from) : '(absent)';
  const to = d.to.length ? joinVersions(d.to) : '(absent)';
  return `${d.tool} ${from} -> ${to}  ${d.detail}`;
}

/**
 * The deadline block for the source label, or null when the label has no
 * announced deadline.
 */
export function deadlineLines(label, now = new Date()) {
  const dl = deadlineFor(label);
  if (!dl) return null;
  const lines = [];
  const brownout = dl.brownouts?.[0];
  lines.push(
    brownout
      ? `${label} is fully unsupported on ${dl.fullyUnsupported}; brownouts begin ${brownout} (source: ${dl.sourceRef})`
      : `${label} is fully unsupported on ${dl.fullyUnsupported} (source: ${dl.sourceRef})`,
  );
  const left = daysUntil(dl.fullyUnsupported, now);
  const untilBrownout = brownout ? daysUntil(brownout, now) : null;
  const countdown =
    left === null
      ? null
      : left > 0
        ? `${left} days left${untilBrownout !== null && untilBrownout > 0 ? ` (${untilBrownout} until the first brownout)` : ''}`
        : `retired ${Math.abs(left)} days ago`;
  if (countdown) {
    lines.push(`${countdown} — deprecation began ${dl.deprecationStart}; see ${dl.source}`);
  }
  if (dl.brownoutWindow && dl.brownouts?.length) {
    lines.push(`brownout windows (${dl.brownoutWindow}): ${dl.brownouts.join(', ')}`);
  }
  if (dl.migrateTo?.length) {
    lines.push(`announced migration targets: ${dl.migrateTo.join(', ')}`);
  }
  return lines;
}

/**
 * Full `plan` report.
 * @returns {string}
 */
export function planReport({ from, to, fromImage, toImage, diffs, detected, now = new Date() }) {
  const out = [];
  out.push(`${from} -> ${to} (images ${fromImage} -> ${toImage})`);
  const dl = deadlineLines(from, now);
  if (dl) out.push(...dl);
  else out.push(`${from} has no announced deprecation deadline in runner-drift's table.`);
  out.push('');

  const changed = diffs.filter((d) => d.changed);
  if (!changed.length) {
    out.push(`No change to any of the ${diffs.length} tool(s) your workflows use.`);
  } else {
    for (const d of changed) out.push(planRow(d));
    out.push('');
    const unchanged = diffs.length - changed.length;
    out.push(
      `${changed.length} of ${diffs.length} detected tool(s) change` +
        (unchanged ? `; ${unchanged} unchanged (not shown)` : ''),
    );
  }
  if (detected?.missingFromManifest?.length) {
    out.push(
      `Not listed on either image manifest (skipped): ${detected.missingFromManifest.join(', ')}`,
    );
  }
  return out.join('\n');
}

const SEVERITY_BADGE = {
  major: '🔴 MAJOR',
  minor: '🟠 MINOR',
  patch: '🟡 PATCH',
  none: '⚪ none',
};

/** GitHub step-summary markdown for a `guard` run. */
export function stepSummaryMarkdown({
  label,
  fromImage,
  toImage,
  diffs,
  attribution = {},
  approximate = false,
  baseline = false,
  lockFile,
}) {
  const lines = [];
  lines.push('## runner-drift');
  lines.push('');
  if (baseline) {
    lines.push(
      `Baseline recorded for \`${label}\` at image \`${toImage}\` — ${Object.keys(diffs).length || diffs.length} tool(s) locked in \`${lockFile}\`.`,
    );
    lines.push('');
    lines.push('The next run on a bumped image will diff against this baseline.');
    return `${lines.join('\n')}\n`;
  }

  const changed = diffs.filter((d) => d.changed);
  lines.push(`\`${label}\` image \`${fromImage}\` → \`${toImage}\``);
  if (approximate) {
    lines.push('');
    lines.push(
      '> ⚠️ **approximate** — this image version has no matching commit in the runner-images readme history yet (the readme lags the rollout), so attribution uses the nearest earlier commit.',
    );
  }
  lines.push('');
  if (!changed.length) {
    lines.push(`No tool drift across ${diffs.length} locked tool(s).`);
    return `${lines.join('\n')}\n`;
  }

  lines.push('| Tool | Locked | Now | Change | Shipped by |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const d of changed) {
    const a = attribution[d.tool];
    const shipped = a
      ? `[${a.imageVersion ?? a.sha.slice(0, 7)}](${a.url})${a.exact ? '' : ' _(approx)_'}`
      : '—';
    const badge = SEVERITY_BADGE[d.severity] ?? d.severity;
    const change = d.detail === d.severity.toUpperCase() ? badge : `${badge} — ${d.detail}`;
    lines.push(
      `| \`${d.tool}\` | ${d.from.join(', ') || '—'} | ${d.to.join(', ') || '—'} | ${change} | ${shipped} |`,
    );
  }
  lines.push('');
  lines.push(`Lock file \`${lockFile}\` updated to image \`${toImage}\`.`);
  return `${lines.join('\n')}\n`;
}

function escapeAnnotation(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** `::warning ...` lines for the workflow log. */
export function annotations(diffs, attribution = {}, label = '') {
  return diffs
    .filter((d) => d.changed)
    .map((d) => {
      const a = attribution[d.tool];
      const where = a ? ` — shipped by ${a.imageVersion ?? a.sha.slice(0, 7)} ${a.url}` : '';
      const sev = d.severity.toUpperCase();
      const detail = d.detail === sev ? sev : `${sev}: ${d.detail}`;
      const msg = `${d.tool} drifted on ${label}: ${d.from.join(', ') || '(absent)'} -> ${d.to.join(', ') || '(absent)'} (${detail})${where}`;
      return `::warning title=runner-drift: ${escapeAnnotation(d.tool)} ${d.severity}::${escapeAnnotation(msg)}`;
    });
}

export function notice(message) {
  return `::notice title=runner-drift::${escapeAnnotation(message)}`;
}

/** Append markdown to $GITHUB_STEP_SUMMARY when running inside Actions. */
export async function writeStepSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return false;
  try {
    await appendFile(file, `${markdown}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
