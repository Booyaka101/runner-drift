/**
 * Self-hosted runner agent versions, and GitHub's end-of-support dates for them.
 *
 * Two endpoints, both on api.github.com:
 *   GET /{scope}/actions/runners                    -> the fleet, each runner's `version`
 *   GET /{scope}/actions/runners/deprecations/{ver}  -> when that version stops working
 *
 * Unlike the image deadlines in labels.mjs these dates cannot be a table. The
 * rule is rolling: every actions/runner release has to be installed within 30
 * days of publication, so the cut-off for any given version moves each time a
 * new one ships. Hence one lookup per distinct version, cached per run — twenty
 * runners on one version cost one call.
 *
 * Both endpoints need administration / self-hosted-runner read, which the
 * default GITHUB_TOKEN does not carry. A refusal is a reported status, never a
 * crash and never a failing exit code on its own.
 */

import { fetchJson } from './http.mjs';
import { compareDottedNumbers } from './diff.mjs';
import { daysUntil, isPast } from './dates.mjs';
import { API_BASE } from './labels.mjs';

/** GitHub's own rule: install each release within 30 days of publication. */
export const DEFAULT_DEPRECATION_WINDOW_DAYS = 30;

/** Minimum version required to register at all (changelog 2026-06-12). */
export const MINIMUM_REGISTRATION_VERSION = '2.329.0';

/**
 * True for a version GitHub will not let register at all, whatever the
 * deprecations endpoint says. Worth reporting on its own because a version old
 * enough to predate the API's records answers 404, i.e. UNKNOWN-VERSION.
 */
export function belowRegistrationMinimum(version) {
  if (!version) return false;
  return compareRunnerVersions(version, MINIMUM_REGISTRATION_VERSION) < 0;
}

export const RUNNER_STATUS = {
  OK: 'OK',
  UNKNOWN_VERSION: 'UNKNOWN-VERSION',
  REGISTRATION_DUE: 'REGISTRATION-DUE',
  RUNTIME_DUE: 'RUNTIME-DUE',
  EXPIRED: 'EXPIRED',
};

/** Worst last, so a sort on the index puts the urgent groups first. */
const STATUS_SEVERITY = [
  RUNNER_STATUS.OK,
  RUNNER_STATUS.UNKNOWN_VERSION,
  RUNNER_STATUS.REGISTRATION_DUE,
  RUNNER_STATUS.RUNTIME_DUE,
  RUNNER_STATUS.EXPIRED,
];

/** Survey-level statuses: the fleet could not be read at all. */
export const SURVEY_STATUS = {
  OK: 'OK',
  PERMISSION: 'PERMISSION',
  UNAVAILABLE: 'UNAVAILABLE',
};

export const GHES_NOTE =
  'enforcement covers github.com and GitHub Enterprise Cloud, not GitHub Enterprise Server';

export const AUTO_UPDATE_NOTE =
  'self-hosted runners auto-update by default — at risk are the ones registered with ' +
  '--disableupdate, baked into a VM or container image, or pinned by actions-runner-controller';

const SOURCE_CHANGELOG = 'https://github.blog/changelog/2026-06-12-github-actions-minimum-version-enforcement-timeline-for-self-hosted-runners/';

/** What a caller has to fix when the listing is refused, one line each. */
const PERMISSION_HINT = {
  repo: [
    'A fine-grained token needs the "Administration" repository permission (read);',
    'a classic token needs the `repo` scope. The default GITHUB_TOKEN has neither.',
  ],
  org: [
    'A fine-grained token needs the "Self-hosted runners" organization permission (read);',
    'a classic token needs the `admin:org` scope. The default GITHUB_TOKEN has neither.',
  ],
};

const NO_TOKEN_HINT = ['These endpoints are never readable anonymously — set GITHUB_TOKEN.'];

/* ------------------------------------------------------------------- scopes */

export function repoScope(owner, repo) {
  return { kind: 'repo', owner, repo, name: `${owner}/${repo}`, path: `/repos/${owner}/${repo}` };
}

export function orgScope(org) {
  return { kind: 'org', org, name: org, path: `/orgs/${org}` };
}

/**
 * Resolve `--repo` / `--org` (falling back to $GITHUB_REPOSITORY) to one scope.
 * @returns {{scope:object}|{error:string, detail?:string}}
 */
export function resolveScope({ repo = null, org = null, env = {} } = {}) {
  if (repo && org) {
    return { error: '--repo and --org are mutually exclusive — pick one.' };
  }
  if (org) {
    const name = String(org).trim();
    if (!name || /[/\s]/.test(name)) {
      return { error: `--org takes an organization name, not "${org}".` };
    }
    return { scope: orgScope(name) };
  }
  const slug = String(repo ?? env.GITHUB_REPOSITORY ?? '').trim();
  if (!slug) {
    return {
      error: 'No repository to look at.',
      detail: 'Pass --repo <owner/repo> or --org <name> (inside a workflow $GITHUB_REPOSITORY is used).',
    };
  }
  const parts = slug.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { error: `--repo takes owner/repo, not "${slug}".` };
  }
  return { scope: repoScope(parts[0], parts[1]) };
}

export function runnersUrl(scope) {
  return `${API_BASE}${scope.path}/actions/runners`;
}

export function deprecationsUrl(scope, version) {
  return `${API_BASE}${scope.path}/actions/runners/deprecations/${encodeURIComponent(version)}`;
}

/** `GET /orgs/acme/actions/runners` — the endpoint as a user would curl it. */
export function endpointLabel(url) {
  return `GET ${String(url).replace(API_BASE, '').replace(/\?.*$/, '')}`;
}

/* ------------------------------------------------------------------ failures */

/**
 * Turn a fetch failure into a reportable survey status. A 403 that is not a
 * rate limit, and a 404, both mean "this token cannot see it" — the same fix.
 */
const REFUSAL = {
  UNAUTHORIZED: 'not authenticated (HTTP 401)',
  FORBIDDEN: 'refused (HTTP 403)',
  NOT_FOUND: 'not visible to this token (HTTP 404)',
};

function describeFailure(err, scope, url) {
  const endpoint = endpointLabel(url);
  const refusal = REFUSAL[err?.code];
  if (refusal) {
    return {
      status: SURVEY_STATUS.PERMISSION,
      message: `${endpoint} was ${refusal}`,
      hint: [
        ...(err.code === 'UNAUTHORIZED' ? NO_TOKEN_HINT : []),
        ...PERMISSION_HINT[scope.kind],
      ],
    };
  }
  return {
    status: SURVEY_STATUS.UNAVAILABLE,
    message: `${endpoint} could not be read — ${err?.message ?? err}`,
    hint: err?.hint ? [err.hint] : [],
  };
}

/* ------------------------------------------------------------------- listing */

/**
 * Every self-hosted runner in the scope, following pagination.
 * @returns {Promise<{ok:true, runners:object[], totalCount:number, url:string}
 *                  |{ok:false, status:string, message:string, hint:string|null, url:string}>}
 */
export async function listRunners(scope, { perPage = 100, maxPages = 10, fetch: fj = fetchJson } = {}) {
  const base = runnersUrl(scope);
  const runners = [];
  let totalCount = null;
  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}?per_page=${perPage}&page=${page}`;
    let json;
    try {
      ({ json } = await fj(url));
    } catch (err) {
      return { ok: false, url: base, ...describeFailure(err, scope, base) };
    }
    if (!json || !Array.isArray(json.runners)) {
      return {
        ok: false,
        url: base,
        status: SURVEY_STATUS.UNAVAILABLE,
        message: `${endpointLabel(base)} returned no \`runners\` array`,
        hint: [],
      };
    }
    if (totalCount === null && Number.isFinite(json.total_count)) totalCount = json.total_count;
    runners.push(...json.runners);
    if (json.runners.length < perPage) {
      return { ok: true, runners, totalCount: totalCount ?? runners.length, url: base, truncated: false };
    }
  }
  // maxPages full pages and still more to come. Report it rather than quietly
  // surveying a prefix of the fleet.
  return {
    ok: true,
    runners,
    totalCount: totalCount ?? runners.length,
    url: base,
    truncated: true,
  };
}

/* -------------------------------------------------------------- deprecations */

function isoOrNull(value) {
  if (typeof value !== 'string' || !value) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * End-of-support dates for one runner version.
 *
 * `registration_deprecates_at` is documented as "string or null" but the live
 * API omits the key entirely on every version checked (2.325.0 through
 * 2.337.0), so an absent key and an explicit null are treated the same.
 *
 * @param {Map|null} cache keyed by version string — one lookup per version, not per runner
 */
export async function lookupDeprecation(scope, version, { cache = null, fetch: fj = fetchJson } = {}) {
  if (cache?.has(version)) return cache.get(version);
  const url = deprecationsUrl(scope, version);
  let result;
  try {
    const { json } = await fj(url);
    result = {
      ok: true,
      url,
      version,
      runnerVersion: typeof json?.runner_version === 'string' ? json.runner_version : version,
      registrationDeprecatesAt: isoOrNull(json?.registration_deprecates_at),
      runtimeDeprecatesAt: isoOrNull(json?.runtime_deprecates_at),
    };
  } catch (err) {
    result =
      err?.code === 'NOT_FOUND'
        ? { ok: false, url, version, unknownVersion: true }
        : { ok: false, url, version, ...describeFailure(err, scope, url) };
  }
  cache?.set(version, result);
  return result;
}

/* ------------------------------------------------------------------ grouping */

/** One entry per distinct `version`, null for runners that never connected. */
export function groupByVersion(runners) {
  const byVersion = new Map();
  for (const r of runners ?? []) {
    const raw = typeof r?.version === 'string' ? r.version.trim() : '';
    const key = raw || null;
    if (!byVersion.has(key)) byVersion.set(key, []);
    byVersion.get(key).push(r);
  }
  return [...byVersion.entries()].map(([version, members]) => ({
    version,
    count: members.length,
    names: members.map((m) => m?.name ?? '(unnamed)'),
    online: members.filter((m) => m?.status === 'online').length,
    busy: members.filter((m) => m?.busy === true).length,
    ephemeral: members.some((m) => m?.ephemeral === true),
    labels: [...new Set(members.flatMap((m) => (m?.labels ?? []).map((l) => l?.name).filter(Boolean)))],
  }));
}

/* ------------------------------------------------------------ classification */

function dateFacts(iso, now) {
  if (!iso) return null;
  const days = daysUntil(iso, now);
  if (days === null) return null;
  return { at: iso, date: iso.slice(0, 10), days, past: isPast(iso, now) };
}

/**
 * Classify one version group. `EXPIRED` is unconditional (same rule the image
 * lane uses for a label past its date); `RUNTIME-DUE` outranks
 * `REGISTRATION-DUE` because jobs stopping beats not being able to re-register,
 * but both dates are always reported.
 */
export function classifyVersion({
  version,
  registrationDeprecatesAt = null,
  runtimeDeprecatesAt = null,
  unknownVersion = false,
  days = DEFAULT_DEPRECATION_WINDOW_DAYS,
  now = new Date(),
} = {}) {
  const runtime = dateFacts(runtimeDeprecatesAt, now);
  const registration = dateFacts(registrationDeprecatesAt, now);
  const facts = { runtime, registration };

  if (!version || unknownVersion) {
    return { status: RUNNER_STATUS.UNKNOWN_VERSION, ...facts };
  }
  if (runtime?.past || registration?.past) {
    return { status: RUNNER_STATUS.EXPIRED, ...facts };
  }
  if (runtime && runtime.days <= days) {
    return { status: RUNNER_STATUS.RUNTIME_DUE, ...facts };
  }
  if (registration && registration.days <= days) {
    return { status: RUNNER_STATUS.REGISTRATION_DUE, ...facts };
  }
  return { status: RUNNER_STATUS.OK, ...facts };
}

/**
 * Does this status fail the run? EXPIRED always; the two DUE statuses only when
 * --fail-on-deprecation asked for a window. UNKNOWN-VERSION never.
 */
export function statusFails(status, { failOn = false } = {}) {
  if (status === RUNNER_STATUS.EXPIRED) return true;
  if (!failOn) return false;
  return status === RUNNER_STATUS.RUNTIME_DUE || status === RUNNER_STATUS.REGISTRATION_DUE;
}

export function statusRank(status) {
  const i = STATUS_SEVERITY.indexOf(status);
  return i === -1 ? 0 : i;
}

/**
 * Identical versions across several hosts, or an ephemeral runner, is the
 * signature of an image or an actions-runner-controller template rather than a
 * host somebody can just re-run config.sh on. Stated as a guess in the output.
 */
export function looksImagePinned(group) {
  return group.count > 1 || group.ephemeral;
}

/* ------------------------------------------------------- release publication */

const RUNNER_RELEASES_URL = `${API_BASE}/repos/actions/runner/releases?per_page=100`;

/**
 * version -> publication date, from actions/runner's own releases. Best effort:
 * it only annotates the report, so any failure returns an empty map rather than
 * taking the survey down with it.
 */
export async function releasePublishDates({ fetch: fj = fetchJson } = {}) {
  const dates = new Map();
  try {
    const { json } = await fj(RUNNER_RELEASES_URL);
    if (!Array.isArray(json)) return dates;
    for (const rel of json) {
      const tag = String(rel?.tag_name ?? '').replace(/^v/, '');
      const at = isoOrNull(rel?.published_at);
      if (tag && at) dates.set(tag, at);
    }
  } catch {
    return dates;
  }
  return dates;
}

/* -------------------------------------------------------------------- survey */

/**
 * The whole picture for one scope: fleet, versions, dates, statuses.
 *
 * @param {object} scope repoScope()/orgScope()
 * @param {object} opts
 * @param {number} opts.days classification window (EXPIRED ignores it)
 * @param {boolean} opts.failOn whether --fail-on-deprecation was given
 * @param {string|null} opts.onlyRunnerName narrow to one runner, for `guard`
 * @param {boolean} opts.publishDates annotate OK rows with the release date
 */
export async function surveyRunners(
  scope,
  {
    days = DEFAULT_DEPRECATION_WINDOW_DAYS,
    failOn = false,
    now = new Date(),
    onlyRunnerName = null,
    publishDates = true,
    fetch: fj = fetchJson,
  } = {},
) {
  const base = {
    scope: { kind: scope.kind, name: scope.name, path: scope.path },
    runnersUrl: runnersUrl(scope),
    windowDays: days,
    failOn,
    checkedAt: now.toISOString(),
    ghesNote: GHES_NOTE,
    autoUpdateNote: AUTO_UPDATE_NOTE,
    source: SOURCE_CHANGELOG,
  };

  const listed = await listRunners(scope, { fetch: fj });
  if (!listed.ok) {
    return { ...base, status: listed.status, message: listed.message, hint: listed.hint, groups: [], totalCount: null };
  }

  const all = listed.runners;
  const selected = onlyRunnerName ? all.filter((r) => r?.name === onlyRunnerName) : all;
  const groups = groupByVersion(selected);

  const cache = new Map();
  const resolved = [];
  for (const group of groups) {
    if (group.version === null) {
      resolved.push({ ...group, ...classifyVersion({ version: null, days, now }), source: null, publishedAt: null });
      continue;
    }
    const dep = await lookupDeprecation(scope, group.version, { cache, fetch: fj });
    // The listing worked, so a refusal here is systemic: stop rather than
    // repeat a doomed call for every remaining version.
    if (!dep.ok && !dep.unknownVersion) {
      return { ...base, status: dep.status, message: dep.message, hint: dep.hint, groups: [], totalCount: listed.totalCount };
    }
    resolved.push({
      ...group,
      ...classifyVersion({
        version: group.version,
        registrationDeprecatesAt: dep.registrationDeprecatesAt ?? null,
        runtimeDeprecatesAt: dep.runtimeDeprecatesAt ?? null,
        unknownVersion: Boolean(dep.unknownVersion),
        days,
        now,
      }),
      unknownVersion: Boolean(dep.unknownVersion),
      source: endpointLabel(dep.url),
      publishedAt: null,
      imagePinned: looksImagePinned(group),
    });
  }

  // The publication date only annotates an OK row ("published X, no end date
  // returned"), so it is fetched after classification or not at all.
  if (publishDates && resolved.some((g) => g.status === RUNNER_STATUS.OK && g.version)) {
    const dates = await releasePublishDates({ fetch: fj });
    for (const g of resolved) {
      if (g.status === RUNNER_STATUS.OK) g.publishedAt = dates.get(g.version) ?? null;
    }
  }

  resolved.sort(
    (a, b) =>
      statusRank(b.status) - statusRank(a.status) ||
      compareRunnerVersions(a.version, b.version) ||
      a.count - b.count,
  );

  return {
    ...base,
    status: SURVEY_STATUS.OK,
    truncated: Boolean(listed.truncated),
    totalCount: onlyRunnerName ? selected.length : listed.totalCount,
    fleetCount: all.length,
    groups: resolved,
    failing: resolved.some((g) => statusFails(g.status, { failOn })),
  };
}

/** Ascending numeric compare for `2.335.1`; a null version sorts last. */
export function compareRunnerVersions(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareDottedNumbers(a, b);
}
