/**
 * The floating-label migration lane.
 *
 * labels.mjs answers the calendar half from the MIGRATIONS table — where today
 * sits in the window, and which image the runner actually served. This module
 * answers the other half from the live manifests: what is different between the
 * image the label means today and the one it will mean when the window closes.
 *
 * The diff is the whole point. A warning that says "ubuntu-latest moves to
 * Ubuntu 26.04 next month" is a calendar entry; "your kernel goes 6.17 -> 7.0
 * and Node.js 22 -> 24" is something you can act on before it happens.
 */

import { IMAGE_OS_TO_LABEL, migrationFor, migrationStatus } from './labels.mjs';
import { siteInJob } from './detect.mjs';
import { loadManifest, resolveManifestVersions } from './manifest.mjs';
import { diffTool } from './diff.mjs';
import { errorText } from './http.mjs';

/**
 * Image-level facts that are not installed tools but change with the OS. They
 * live in the manifest header, so nothing in the tool table records them.
 */
export const IMAGE_FIELDS = [
  ['OS', 'osVersion'],
  ['Kernel', 'kernelVersion'],
  ['Systemd', 'systemdVersion'],
];

const one = (v) => (v ? [v] : null);

/**
 * Diff the manifest headers of two images. A field missing from both — macOS
 * manifests carry no kernel or systemd line — diffs to `missing` and is
 * dropped by the `changed` filter, so no caller has to special-case it.
 */
export function imageDiffs(from, to) {
  return IMAGE_FIELDS.map(([name, field]) => diffTool(name, one(from?.[field]), one(to?.[field])));
}

/**
 * Whether this runner's `ImageOS` says anything about this label, and why not.
 *
 * One runner serves one job. Its image is evidence about `ubuntu-latest` only if
 * the job it is running asked for `ubuntu-latest`; a lint job pinned to
 * `ubuntu-22.04` that happens to scan a repo using the floating label would
 * otherwise report the whole migration as having gone somewhere unexpected.
 *
 * Two weaker cases attribute anyway, but only when the image is one of the two
 * the window names, which is evidence the runner did come from this label: a
 * matrix leg (the file cannot say which leg this runner is), and a run with no
 * `GITHUB_JOB` to match against (`guard` invoked outside a workflow job).
 */
export function attributeImageOS({ label, imageOS, sites = [], here = null }) {
  if (!imageOS) return { imageOS: null, note: null };
  const m = migrationFor(label);
  const observed = IMAGE_OS_TO_LABEL[String(imageOS).toLowerCase()] ?? null;
  const endpoint = observed === m?.from || observed === m?.to;
  const mine = sites.filter((site) => siteInJob(site, here));

  if (mine.some((site) => !site.viaMatrix)) return { imageOS, note: null };
  if (mine.length) {
    if (endpoint) return { imageOS, note: null };
    return {
      imageOS: null,
      note: `Job "${here.job}" reaches ${label} through a matrix and ran on ${observed ?? imageOS}, `
        + 'which is neither image in the window, so this runner is treated as a different matrix leg.',
    };
  }
  if (!here) {
    if (endpoint) return { imageOS, note: null };
    return {
      imageOS: null,
      note: `This check did not run on ${label}, so its ImageOS is not evidence about the migration.`,
    };
  }
  return {
    imageOS: null,
    note: `The job that ran this check ("${here.job}") did not run on ${label}, `
      + 'so its ImageOS is not evidence about the migration.',
  };
}

/**
 * One floating label, classified and (where it helps) diffed.
 *
 * `plan` calls this for the label the user named; `guard` calls it for every
 * floating label its workflows actually use. Both get the same object, so the
 * report renderers do not need to know which lane they are serving.
 *
 * Network failures and 404s land in `notes` rather than throwing: the notice is
 * worth printing even when the manifests cannot be read, which is exactly the
 * degraded case the brief calls for.
 *
 * @returns {Promise<object|null>} null when the label has no announced migration
 */
export async function surveyMigration({
  label,
  now = new Date(),
  imageOS = null,
  tools = [],
  sites = [],
  here = null,
  load = loadManifest,
} = {}) {
  const attributed = attributeImageOS({ label, imageOS, sites, here });
  const status = migrationStatus(label, { now, imageOS: attributed.imageOS });
  if (!status) return null;

  const survey = {
    ...status,
    sites,
    images: null,
    image: [],
    toolDiffs: [],
    notOnManifest: [],
    notes: attributed.note ? [attributed.note] : [],
  };

  // Once the label already means `to`, the lock diff in `guard` is the real
  // before/after and this one would only restate it from the manifests.
  if (status.done) return survey;

  let a;
  let b;
  try {
    [a, b] = await Promise.all([load(status.from), load(status.to)]);
  } catch (err) {
    survey.notes.push(`Manifest diff unavailable: ${errorText(err)}`);
    return survey;
  }
  for (const m of [a, b]) {
    if (m.skipped) survey.notes.push(`Manifest diff unavailable: ${m.reason}`);
  }
  if (a.skipped || b.skipped) return survey;

  survey.images = { from: a.imageVersion, to: b.imageVersion };
  survey.image = imageDiffs(a, b).filter((d) => d.changed);

  const ra = resolveManifestVersions(a, tools);
  const rb = resolveManifestVersions(b, tools);
  survey.notOnManifest = tools.filter((t) => ra.missing.includes(t) && rb.missing.includes(t));
  survey.toolDiffs = tools
    .filter((t) => !survey.notOnManifest.includes(t))
    .map((t) => diffTool(t, ra.map[t] ?? null, rb.map[t] ?? null))
    .filter((d) => d.changed);

  return survey;
}
