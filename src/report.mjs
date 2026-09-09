/**
 * Output formatting: plain-text plan report, GitHub step-summary markdown,
 * and ::warning workflow annotations.
 *
 * Two lanes share every primitive below — hosted-image retirements (dates from
 * the table in labels.mjs) and self-hosted runner-version deprecations (dates
 * from the API, via runners.mjs). Countdown wording, annotation escaping and
 * table rendering are written once here and called from both.
 */

import { appendFile } from 'node:fs/promises';
import { daysUntil } from './dates.mjs';
import { deadlineFor, retirementStatus } from './labels.mjs';
import {
  MINIMUM_REGISTRATION_VERSION,
  RUNNER_STATUS,
  SURVEY_STATUS,
  belowRegistrationMinimum,
  endpointLabel,
  statusFails,
} from './runners.mjs';

export { daysUntil };

/** `(82 days)` / `(60 days ago)` — the countdown suffix both lanes print. */
export function countdown(days) {
  if (days === null || days === undefined) return '';
  return days < 0 ? `(${Math.abs(days)} days ago)` : `(${days} days)`;
}

/** `2026-11-02 (82 days)`. A full ISO date-time is trimmed to its date. */
export function dateWithCountdown(date, days) {
  return `${String(date ?? '').slice(0, 10)} ${countdown(days)}`.trim();
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
  const countdownLine =
    left === null
      ? null
      : left > 0
        ? `${left} days left${untilBrownout !== null && untilBrownout > 0 ? ` (${untilBrownout} until the first brownout)` : ''}`
        : `retired ${Math.abs(left)} days ago`;
  if (countdownLine) {
    lines.push(`${countdownLine} — deprecation began ${dl.deprecationStart}; see ${dl.source}`);
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

  const rows = changed.map((d) => {
    const a = attribution[d.tool];
    const shipped = a
      ? `[${a.imageVersion ?? a.sha.slice(0, 7)}](${a.url})${a.exact ? '' : ' _(approx)_'}`
      : '—';
    const badge = SEVERITY_BADGE[d.severity] ?? d.severity;
    const change = d.detail === d.severity.toUpperCase() ? badge : `${badge} — ${d.detail}`;
    return [`\`${d.tool}\``, d.from.join(', ') || '—', d.to.join(', ') || '—', change, shipped];
  });
  lines.push(...markdownTable(['Tool', 'Locked', 'Now', 'Change', 'Shipped by'], rows));
  lines.push('');
  lines.push(`Lock file \`${lockFile}\` updated to image \`${toImage}\`.`);
  return `${lines.join('\n')}\n`;
}

function escapeAnnotation(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * One workflow-log annotation. `site` ({file,line,col}) makes it a file
 * annotation; without one GitHub attributes it to the step.
 */
export function annotation(kind, title, message, site = null) {
  // GitHub matches `file=` against the repo tree, which is POSIX-separated, so a
  // path built by path.join on a Windows runner has to be converted or the
  // annotation silently lands on the step instead of the line.
  const where = site
    ? `file=${escapeAnnotation(String(site.file).replaceAll('\\', '/'))},line=${site.line},col=${site.col},`
    : '';
  return `::${kind} ${where}title=${escapeAnnotation(title)}::${escapeAnnotation(message)}`;
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
      return annotation('warning', `runner-drift: ${d.tool} ${d.severity}`, msg);
    });
}

export function notice(message) {
  return annotation('notice', 'runner-drift', message);
}

/**
 * Header, separator and body rows of a GitHub-flavoured markdown table. Cells
 * are escaped, because runner names are user-controlled and a bare `|` silently
 * splits the row into the wrong columns.
 */
export function markdownTable(headers, rows) {
  const cell = (v) => String(v).replaceAll('|', '\\|');
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
}

/**
 * One finding per label site that retires, browns out or is already retired
 * within `days`. A retired label always fires, whatever the threshold.
 */
export function retirementFindings(labelSites, { now = new Date(), days } = {}) {
  const findings = [];
  for (const site of labelSites ?? []) {
    const status = retirementStatus(site.label, now);
    if (!status) continue;
    const retiring = status.retired || status.daysToUnsupported <= days;
    const brownoutSoon = status.daysToBrownout !== null && status.daysToBrownout <= days;
    if (!retiring && !brownoutSoon) continue;
    findings.push({ ...site, status, trigger: retiring ? 'retirement' : 'brownout' });
  }
  return findings;
}

function retirementMessage(s) {
  const migrate = `Migrate to ${s.migrateTo.join(', ')}.`;
  if (s.retired) {
    return `${s.label} retired ${Math.abs(s.daysToUnsupported)} days ago — fully unsupported since ${s.fullyUnsupported}. ${migrate} See ${s.source}`;
  }
  const brownout = s.nextBrownout
    ? `; next brownout ${dateWithCountdown(s.nextBrownout, s.daysToBrownout)}`
    : '';
  return `${s.label} is fully unsupported on ${dateWithCountdown(s.fullyUnsupported, s.daysToUnsupported)}${brownout}. ${migrate} See ${s.source}`;
}

/**
 * `::error file=,line=,col=` lines pointing at each pinned label. A brownout
 * inside the threshold with retirement still beyond it is a ::warning.
 */
export function retirementAnnotations(findings) {
  return findings.map((f) => {
    const s = f.status;
    let kind = 'error';
    let title = `runner-drift: ${s.label} retires in ${s.daysToUnsupported} days`;
    if (s.retired) {
      title = `runner-drift: ${s.label} retired ${Math.abs(s.daysToUnsupported)} days ago`;
    } else if (f.trigger === 'brownout') {
      kind = 'warning';
      title = `runner-drift: ${s.label} deprecation`;
    }
    return annotation(kind, title, retirementMessage(s), f);
  });
}

/** Step-summary table for retirement findings. */
export function retirementSummaryMarkdown(findings) {
  const rows = findings.map((f) => {
    const s = f.status;
    return [
      `\`${s.label}\``,
      `\`${f.file}:${f.line}\``,
      s.nextBrownout ? dateWithCountdown(s.nextBrownout, s.daysToBrownout) : '—',
      s.retired
        ? `${s.fullyUnsupported} (retired ${Math.abs(s.daysToUnsupported)} days ago)`
        : dateWithCountdown(s.fullyUnsupported, s.daysToUnsupported),
      s.migrateTo.map((m) => `\`${m}\``).join(', '),
      `[${s.sourceRef}](${s.source})`,
    ];
  });
  const lines = [
    '## runner-drift — retirement',
    '',
    ...markdownTable(
      ['Label', 'Where', 'Next brownout', 'Fully unsupported', 'Migrate to', 'Source'],
      rows,
    ),
  ];
  return `${lines.join('\n')}\n`;
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

/* --------------------------------------------- self-hosted runner versions */

const RUNNER_BADGE = {
  [RUNNER_STATUS.EXPIRED]: '🔴 EXPIRED',
  [RUNNER_STATUS.RUNTIME_DUE]: '🟠 RUNTIME-DUE',
  [RUNNER_STATUS.REGISTRATION_DUE]: '🟡 REGISTRATION-DUE',
  [RUNNER_STATUS.UNKNOWN_VERSION]: '❔ UNKNOWN-VERSION',
  [RUNNER_STATUS.OK]: '⚪ OK',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * `x2` / `x2 (1 offline)`. Whether the group is in service changes how urgent it
 * is — an EXPIRED version on a runner still reporting online is the case that
 * matters most, and an offline one may just need recreating from a newer image.
 */
function runnerCount(group) {
  const offline = Number.isFinite(group.online) ? group.count - group.online : 0;
  return offline > 0 ? `x${group.count} (${offline} offline)` : `x${group.count}`;
}

/** At most five names, then a count — a 200-runner fleet is one version group. */
function nameList(names, max = 5) {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/**
 * The `runs-on:` sites worth pointing at: only where a date is actually moving,
 * so an UNKNOWN-VERSION row does not annotate files over a version nobody can
 * date, and an OK row does not annotate them at all.
 */
function dueSites(group) {
  const dated =
    group.status === RUNNER_STATUS.RUNTIME_DUE ||
    group.status === RUNNER_STATUS.REGISTRATION_DUE ||
    group.status === RUNNER_STATUS.EXPIRED;
  return dated ? (group.workflowSites ?? []) : [];
}

/**
 * The detail lines under one version row: what ends when, and why this group is
 * probably not something you fix by hand.
 */
export function runnerGroupDetail(group, { windowDays, sites = true } = {}) {
  const lines = [];
  const { runtime, registration } = group;
  // On an OK row the date is reassurance, so it says why rather than restating
  // the consequence; on a due or expired row the consequence is the point.
  const ok = group.status === RUNNER_STATUS.OK;
  const beyond = Number.isFinite(windowDays) ? `beyond the ${windowDays}-day window` : 'not yet due';
  if (runtime) {
    lines.push(
      runtime.past
        ? `runtime support ended ${dateWithCountdown(runtime.at, runtime.days)} — jobs are no longer queued to it`
        : `runtime support ends ${dateWithCountdown(runtime.at, runtime.days)} — ${ok ? beyond : 'jobs stop being queued'}`,
    );
  }
  if (registration) {
    lines.push(
      registration.past
        ? `registration ended ${dateWithCountdown(registration.at, registration.days)} — it cannot reregister`
        : `registration ends ${dateWithCountdown(registration.at, registration.days)} — ${ok ? beyond : 'cannot register or reregister'}`,
    );
  }
  if (group.status === RUNNER_STATUS.UNKNOWN_VERSION) {
    lines.push(
      group.version === null
        ? 'no version reported — the runner has never connected, so there is nothing to date'
        : `the deprecations API does not recognise version ${group.version} — reporting only, never failing`,
    );
    if (belowRegistrationMinimum(group.version)) {
      lines.push(
        `${group.version} is below the ${MINIMUM_REGISTRATION_VERSION} registration minimum — it cannot register or reregister`,
      );
    }
  }
  if (group.status === RUNNER_STATUS.OK && !runtime && !registration && group.version !== null) {
    lines.push('no end date returned — this version is current');
  }
  for (const field of group.unparsedDates ?? []) {
    lines.push(`the API sent a \`${field}\` this build could not parse — treated as no date, so do not read this row as safe`);
  }
  // Only on a row that is actually actionable. An OK row already prints why it
  // is fine, and "update anyway" on it would be the universal-deadline nagging
  // this report exists to avoid. The value stays in --json either way.
  if (group.updateTo && !ok) {
    const published = group.updateTo.publishedAt
      ? `, published ${group.updateTo.publishedAt.slice(0, 10)}`
      : '';
    lines.push(`update to ${group.updateTo.version}${published} — the newest stable actions/runner release`);
  }
  if (sites) {
    for (const site of dueSites(group)) {
      lines.push(
        `serves ${site.file}:${site.line} (runs-on: ${site.labels.join(', ')}) — ${nameList(site.runners, 3)}`,
      );
    }
  }
  if (group.status !== RUNNER_STATUS.OK && group.status !== RUNNER_STATUS.UNKNOWN_VERSION && group.imagePinned) {
    lines.push(
      group.ephemeral
        ? 'ephemeral runners — change the actions-runner-controller image tag, not the host'
        : 'these look image-pinned; update the image or template, not the host',
    );
  }
  return lines;
}

/**
 * Anything the run cannot stand behind about how much of the fleet it saw. The
 * header counts what was actually classified, so a shortfall is said out loud
 * rather than papered over with the number the API claimed.
 */
function countNotes(survey) {
  if (survey.truncated) {
    return [
      `note: the runner listing was cut off after ${survey.surveyedCount} of ${survey.totalCount} — this is a prefix of the fleet, not all of it`,
    ];
  }
  if (Number.isFinite(survey.totalCount) && survey.totalCount !== survey.surveyedCount) {
    return [
      `note: the API reported ${plural(survey.totalCount, 'runner')} but returned ${survey.surveyedCount} — only what it returned was checked`,
    ];
  }
  return [];
}

/** Plain-text `runners` report. Mirrors planReport()'s shape for the other lane. */
export function runnersReport(survey) {
  const out = [];
  const head = `self-hosted runners — ${survey.scope.name}`;

  if (survey.status !== SURVEY_STATUS.OK) {
    out.push(head);
    out.push(`${survey.status}  ${survey.message}`);
    for (const line of survey.hint ?? []) {
      out.push(`${' '.repeat(survey.status.length + 2)}${line}`);
    }
    return out.join('\n');
  }

  if (!survey.groups.length) {
    out.push(`${head} (${plural(survey.surveyedCount ?? 0, 'runner')})`);
    out.push('no self-hosted runners registered — nothing to check; GitHub-hosted runners are not affected');
    out.push(...countNotes(survey));
    out.push(`source: ${endpointLabel(survey.runnersUrl)}`);
    return out.join('\n');
  }

  out.push(
    `${head} (${plural(survey.surveyedCount, 'runner')}, ${plural(survey.groups.length, 'version')})`,
  );

  const statusWidth = Math.max(13, ...survey.groups.map((g) => g.status.length)) + 1;
  const versionWidth = Math.max(...survey.groups.map((g) => (g.version ?? '(none)').length)) + 2;
  for (const g of survey.groups) {
    const published =
      g.status === RUNNER_STATUS.OK && g.publishedAt
        ? `  (published ${g.publishedAt.slice(0, 10)})`
        : '';
    out.push(
      `  ${g.status.padEnd(statusWidth)}${(g.version ?? '(none)').padEnd(versionWidth)}${runnerCount(g)}  ${nameList(g.names)}${published}`,
    );
    const indent = ' '.repeat(2 + statusWidth);
    for (const line of runnerGroupDetail(g, { windowDays: survey.windowDays })) {
      out.push(`${indent}${line}`);
    }
  }

  out.push(...countNotes(survey));
  if (survey.groups.some((g) => g.status !== RUNNER_STATUS.OK)) {
    out.push(`note: ${survey.autoUpdateNote}`);
  }
  out.push(`note: ${survey.ghesNote}`);
  for (const source of [...new Set(survey.groups.filter((g) => g.source).map((g) => g.source))]) {
    out.push(`source: ${source}`);
  }
  return out.join('\n');
}

/**
 * Workflow-log annotations for a survey. A refused or unreachable endpoint is a
 * ::warning so the log is not silently green; only a real deprecation escalates.
 */
export function runnersAnnotations(survey) {
  if (survey.status !== SURVEY_STATUS.OK) {
    return [
      annotation(
        'warning',
        `runner-drift: ${survey.status}`,
        [`${survey.message}.`, ...(survey.hint ?? [])].join(' '),
      ),
    ];
  }
  const lines = [];
  for (const g of survey.groups) {
    if (g.status === RUNNER_STATUS.OK) continue;
    const fails = statusFails(g.status, { failOn: survey.failOn });
    const kind = fails ? 'error' : g.status === RUNNER_STATUS.UNKNOWN_VERSION ? 'notice' : 'warning';
    const detail = runnerGroupDetail(g, { windowDays: survey.windowDays }).join('; ');
    const which = g.version
      ? `${g.count} self-hosted runner(s) on ${g.version}`
      : `${g.count} self-hosted runner(s) with no version reported`;
    lines.push(
      annotation(
        kind,
        `runner-drift: runner ${g.version ?? '(no version)'} ${g.status}`,
        `${which} (${nameList(g.names)}): ${detail}. ${survey.ghesNote}.`,
      ),
    );
    // And on the exact `runs-on:` line of every job those runners serve, which
    // is where the person who has to fix it is looking. Same idea as the image
    // lane annotating a pinned label.
    // Without the `serves` lines: this annotation is already on that line.
    const onSite = runnerGroupDetail(g, { windowDays: survey.windowDays, sites: false }).join('; ');
    for (const site of dueSites(g)) {
      lines.push(
        annotation(
          kind,
          `runner-drift: this job's runners are on ${g.version}`,
          `${which} serve this job (${nameList(site.runners, 3)}): ${onSite}.`,
          site,
        ),
      );
    }
  }
  return lines;
}

/** Step-summary table for a survey. */
export function runnersSummaryMarkdown(survey) {
  const lines = ['## runner-drift — self-hosted runners', ''];
  if (survey.status !== SURVEY_STATUS.OK) {
    lines.push(`\`${survey.scope.name}\` — **${survey.status}**: ${survey.message}`);
    for (const line of survey.hint ?? []) lines.push('', `> ${line}`);
    return `${lines.join('\n')}\n`;
  }
  const caveats = countNotes(survey).map((n) => `> ⚠️ ${n.replace(/^note: /, '')}`);
  if (!survey.groups.length) {
    lines.push(
      `\`${survey.scope.name}\` has no self-hosted runners registered — nothing to check.`,
    );
    for (const c of caveats) lines.push('', c);
    return `${lines.join('\n')}\n`;
  }
  lines.push(
    `\`${survey.scope.name}\` — ${plural(survey.surveyedCount, 'runner')} on ${plural(survey.groups.length, 'version')}, window ${survey.windowDays} days.`,
  );
  for (const c of caveats) lines.push('', c);
  lines.push('');
  const rows = survey.groups.map((g) => [
    `\`${g.version ?? '(none)'}\``,
    `${runnerCount(g)} ${nameList(g.names, 3)}`,
    RUNNER_BADGE[g.status] ?? g.status,
    g.runtime ? dateWithCountdown(g.runtime.at, g.runtime.days) : '—',
    g.registration ? dateWithCountdown(g.registration.at, g.registration.days) : '—',
    // Same rule as the text report: a target only where the row is actionable.
    g.updateTo && g.status !== RUNNER_STATUS.OK ? `\`${g.updateTo.version}\`` : '—',
  ]);
  lines.push(
    ...markdownTable(
      ['Version', 'Runners', 'Status', 'Runtime ends', 'Registration ends', 'Update to'],
      rows,
    ),
  );
  // The endpoint is cited once per version rather than as a column: it is the
  // same path on every row bar the version, which column one already shows.
  const sources = [...new Set(survey.groups.filter((g) => g.source).map((g) => g.source))];
  if (sources.length) {
    lines.push('');
    lines.push(`Source: ${sources.map((s) => `\`${s}\``).join(', ')}`);
  }
  lines.push('');
  lines.push(`> ${survey.autoUpdateNote}`);
  lines.push('>');
  lines.push(`> ${survey.ghesNote} — see [the enforcement timeline](${survey.source}).`);
  return `${lines.join('\n')}\n`;
}
