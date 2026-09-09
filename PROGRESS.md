# PROGRESS — runner-drift

**Status: v1.2.0 BUILT, NOT YET RELEASED.** On branch
`runner-version-deprecations`. 219/219 tests green, the byte-diff proof holds (33
of 38 scenarios identical, the five that moved are the two bugs this release
fixes), and the real end-to-end runs were done against the live GitHub API. Needs
the owner to open the PR, publish to npm and cut the tag.

- Repo: <https://github.com/Booyaka101/runner-drift>
- npm: <https://www.npmjs.com/package/runner-drift> (latest published: `1.1.0`)
- Releases: `v1.0.0`-`v1.1.0`; moving tag `v1` currently on v1.1.0

## NEXT STEPS (owner, from the phone)

No ETARGET dance this time. 1.1.0 shipped with one CI step expected to be red
until publish, which is how you learn to ignore a red X on the run you are about
to tag. Two changes removed it: the composite action is now tested against the
tarball the job builds, and the registry-spec step skips itself until the version
is actually on npm. So CI is green on the PR and green again after publish, when
that last step starts running for real.

1. PR from `runner-version-deprecations`, CI green on every job.
2. Merge to `main`, CI green on the merge commit.
3. Tag `v1.2.0`. `release.yml` publishes to npm by OIDC with provenance — no
   token anywhere (`e7ee2e3`).
4. Poll `npm view runner-drift@1.2.0 version` until it resolves (LESSONS
   2026-08-05: the registry lags `publish`), then re-run CI so the registry-spec
   step runs.
5. Cut the GitHub release from the 1.2.0 CHANGELOG entry. `major-tag.yml` moves
   `v1` on `release: published`, and the Marketplace listing picks up new
   releases by itself now that it exists (LESSONS 2026-08-20), so no 2FA step.

**Left after the release:** dogfood a `runner-versions` lint job into the repos
that run runner-drift **and** actually own self-hosted runners. It needs a PAT
with administration read, so it is only worth wiring where such a token already
exists; on a repo with no self-hosted runners the command correctly reports 0 and
exits 0, which is a no-op job not worth adding.

---

## v1.2.0 (2026-09-09) — self-hosted runner agent versions

### Phase 0 — every resource re-verified live before any code was written

| Resource | Result |
| --- | --- |
| [changelog 2026-09-03](https://github.blog/changelog/2026-09-03-github-actions-early-september-2026-updates/) | Present as quoted: "A new REST API returns when registration and runtime support end for a given runner version", endpoint `GET /actions/runners/deprecations/{version}`, repository/organization/enterprise scopes, fields `runner_version` / `runtime_deprecates_at` / `registration_deprecates_at`. Dated 2026-09-03 |
| [REST docs, self-hosted-runners](https://docs.github.com/en/rest/actions/self-hosted-runners?apiVersion=2022-11-28) | Both paths confirmed: `GET /orgs/{org}/actions/runners/deprecations/{version}` and `GET /repos/{owner}/{repo}/actions/runners/deprecations/{version}`, path param `version` = "The runner version to look up", 200 = `runner_version` (string, required) plus `registration_deprecates_at` / `runtime_deprecates_at` (string or null, date-time). The listing gives each runner `id`, `runner_group_id`, `name`, `os`, `status`, `busy`, `labels`, `ephemeral`, `version` (string or null) |
| [changelog 2026-06-12](https://github.blog/changelog/2026-06-12-github-actions-minimum-version-enforcement-timeline-for-self-hosted-runners/) | "The runner must be on version `2.329.0` or later"; installing "each new runner release within 30 days of its publication"; GHEC+DR enforced 2026-07-31 (brownouts from 2026-06-29), GHEC 2026-09-25 (brownouts from 2026-08-24); below-registration runners "won't be able to register or reregister", below-runtime ones "will stop running workflow jobs"; **"GitHub Enterprise Server isn't impacted at this time"**; required actions include updating "installation scripts, VM images, container images, and deployment automation" |
| [docs, self-hosted runners reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners) | "If you do not perform a software update within 30 days, the GitHub Actions service will not queue jobs to your runner." Plus the critical-security-update sentence, auto-update as the default, and `--disableupdate` at `config.sh` time |
| `api.github.com/repos/actions/runner/releases` | HTTP 200. v2.337.0 2026-08-26T14:33:29Z, v2.336.0 2026-07-20, v2.335.1 2026-06-09, v2.335.0 2026-06-08, v2.334.0 2026-04-21 — exactly the cadence the brief quoted |
| The deprecations endpoint, **called for real** | The route exists: 401 unauthenticated, while a bogus sibling path returns 404. With a `repo`-scoped token on `Booyaka101/runner-drift` it returns 200 with real dates for 2.325.0, 2.328.0, 2.329.0, 2.330.0, 2.334.0, 2.335.0, 2.335.1, 2.336.0 and 2.337.0, and 404 for `9.9.9` with a `documentation_url` naming `#get-runner-version-end-of-life-schedule-for-a-repository` |
| The listing endpoint, **called for real** | HTTP 200, `{"total_count": 0, "runners": []}` |
| [`canblmz1/gh-runner-eol`](https://github.com/canblmz1/gh-runner-eol) README | Read before designing the output. Reads the same endpoint at repo/org/enterprise scope, scans Dockerfiles/Helm/Terraform/Packer/Ansible/Chef, statuses OVERDUE/WARNING/OK/UNKNOWN, `--warn-days` default 14, table/json/sarif output. Credited as prior art in the CHANGELOG |
| Cost | Zero. Public GitHub API. `runners` needs a token the owner already has (`gh auth token`, classic, `repo` scope). No account created, no trial started, no payment details anywhere |

**Two deviations from the brief, both found by calling the API rather than
reading the docs, both handled rather than guessed:**

1. **`registration_deprecates_at` is absent from every live response**, not null.
   The schema says string-or-null; the API omits the key entirely for all nine
   versions checked, returning only `runtime_deprecates_at`. Absent is therefore
   treated as null, and `REGISTRATION-DUE` cannot fire against today's API. It is
   implemented and covered by tests against both shapes. Said plainly in the
   README Limitations and in the CHANGELOG rather than left implied.
2. **The dates are not publication + 30 days.** The brief's worked example
   derived 2.335.1 -> 2026-09-25 from v2.337.0's publish date. The API actually
   returns `2026-09-24T15:30:55Z`, and 2.336.0 (published 2026-07-20) gets
   2026-11-05, roughly 108 days rather than 30. Whatever GitHub's formula is,
   `runner-drift` reads the date and never computes one. All output and all
   fixtures use the real values, so the worked example reads 2026-09-24 (16 days)
   rather than the brief's illustrative 2026-09-25.

`LESSONS.md` was read in full. Nothing in it contradicted the brief. One new
entry appended: the absent field, plus the 401/403/404 distinction on these
endpoints.

### What changed

- **`src/runners.mjs`** (new). The two API calls, an in-run `Map` cache keyed by
  version string so twenty runners on one version cost one lookup, scope
  resolution for `--repo` / `--org` / `$GITHUB_REPOSITORY`, `groupByVersion`,
  `classifyVersion`, `statusFails`, `looksImagePinned`, a best-effort
  `actions/runner` release-date lookup, and `surveyRunners` tying it together.
  Zero dependencies, the same `fetchJson` and rate-limit path and the same
  optional-token handling as the rest of the package.
- **`src/dates.mjs`** (new). `daysUntil` / `daysFromMs` / `isPast` /
  `MS_PER_DAY`. A third caller made an existing duplication untenable:
  `labels.mjs` carried its own copy under the comment "Duplicated from
  report.mjs, which imports this module". All three now share one implementation
  and that comment is gone.
- **`src/report.mjs`**. `runnersReport` / `runnersAnnotations` /
  `runnersSummaryMarkdown` / `runnerGroupDetail`, built on newly extracted
  primitives the image lane now also uses: `countdown()`, `dateWithCountdown()`,
  `annotation()` (four callers) and `markdownTable()` (three callers).
- **`src/cli.mjs`**. The `runners` command; `--org` / `--repo` /
  `--fail-on-deprecation`; `checkOwnRunner()` on the no-`ImageVersion` path;
  shared `wholeDays()` and `summarise()` so `reportDeprecation` is not a clone of
  `reportRetirement`.
- **`src/diff.mjs`**. `compareDottedNumbers()`, now the single tuple compare for
  both image versions and runner versions.
- **`src/http.mjs`**. A `401` is its own error code with a set-GITHUB_TOKEN hint
  instead of a bare `Unexpected HTTP 401`; the user-agent version was corrected
  (it still said 1.0.2 throughout 1.1.0).
- **`action.yml`**. `fail-on-deprecation` input, `version` default 1.2.0, a
  `github-token` description that no longer claims "rate limit only", a hardened
  `abs()` (Git Bash on `windows-latest` hands it `D:\a\_temp\…`, which was not
  recognised as absolute, so `$PWD` was glued onto the front), and a new `package`
  input so CI can run the composite body against a locally built tarball rather
  than a version that is not on npm yet.
- **`.github/workflows/ci.yml`**. New `runners` job. It asserts the two
  documented outcomes for `github.token` (refused with the permission named, or
  an empty fleet) and that `--repo` + `--org` is exit 2. `permissions:` has no
  `administration` scope, so a refusal is the expected path and the job proves
  the degradation rather than pretending to check a fleet. Plus a `Pack` step and
  a `uses: ./` step with `package:` pointing at that tarball, which finally puts
  the composite action under test before publish — LESSONS 2026-09-01, since the
  step body is the one surface `node --test` cannot reach. The registry-spec
  `uses: ./` step stays alongside it: only a registry spec reproduces the
  npx-resolves-the-CWD collision that 1.0.2 fixed.
- **Two bugs older than this release**, both found by auditing rather than
  reading. `--no-summary` and `--no-update-lock` have been documented since 1.0.0
  and never parsed, because `parseArgs` has no `--no-` negation; every existing
  test set `{ 'update-lock': false }` on `runGuard` directly and so never touched
  the parse layer. And `file=` in every workflow annotation was a path GitHub
  cannot resolve — absolute, because `action.yml` passes `--workflows` absolutely,
  and backslash-separated on Windows — so 1.1.0's headline file annotations
  attached to the step instead of the line for everyone using the action. New
  `annotationPath()` relativises against `$GITHUB_WORKSPACE` and normalises
  separators, fixing both lanes.
- **The workflow join.** `extractRunsOnTargets()` in `src/detect.mjs` keeps each
  `runs-on:` label SET together, which the existing flat `labelSites` cannot do
  (it is one entry per label and drops `self-hosted` outright). `runners` matches
  those sets against each runner's own labels by GitHub's rule — every label in
  the set must be present — and annotates the exact `runs-on:` line of any job an
  at-risk runner serves. Per runner, not per group: the union of a group's labels
  would claim a job can land on a box that cannot take it.
- **Fixtures.** `test/fixtures/runners/deprecations-recorded.json` and
  `runner-releases-recorded.json` are verbatim live responses recorded
  2026-09-09. `fleets.json` holds listings built to the documented schema and
  says so in its own `_note`, because this account owns no self-hosted runners to
  record; the empty listing in the recorded file is real. New fixtures live in
  their own `test/fixtures/runners/` directory so existing whole-tree counts stay
  valid.

### VERIFIED, all run for real on 2026-09-09

- `node --test` -> **219 tests, 219 pass, 0 fail**, fully offline. The 137
  pre-existing tests are unmodified.
- **Byte-diff proof.** A harness ran `init`, `guard` and `plan` across 38
  scenarios (every flag combination, every error path, every `--json` payload,
  the retirement lane, and the self-hosted skip with and without `$RUNNER_NAME`)
  against the repo's own manifest fixtures with the network stubbed, on the
  pre-change tree and again after. Same md5
  (`4a30343aec6146a4c419f6d4499b2cc4`), zero removed lines, and the only
  additions are the new `--help` lines. Re-run after every shared-code change,
  including the `dates.mjs` extraction, the comparator extraction and the
  `http.mjs` 401 change. Harness kept outside the repo at
  `D:\tmp\rd-baseline\harness.mjs`.
- **Clone check.** difflib over every new function against every pre-existing
  one: highest 34.8% (`runRunners` vs `checkOwnRunner`), nothing at or above 60%.
  One extraction was forced by it: `compareRunnerVersions` measured 66.7% against
  `compareImageVersions`, so the tuple compare moved to `compareDottedNumbers()`.
- **Exit-code matrix**, 22 cases through `main()` over the fixtures, asserting the
  documented contract exactly. Ported into the suite as one table-driven test so
  it cannot drift from the README.
- **Flag audit.** Every `--foo` in `--help` fed to the real `OPTIONS` table. This
  is what caught `--no-summary` and `--no-update-lock`, documented since 1.0.0 and
  broken since 1.0.0. Also in the suite now.
- **README transcript check.** All three fenced output blocks in the `runners`
  section are compared byte-for-byte against what the CLI actually prints, so the
  docs cannot drift silently.
- **Live end-to-end**, real token, real API:
  - `runners --repo Booyaka101/runner-drift` -> the real empty fleet, exit 0.
  - The worked example over live dates -> `RUNTIME-DUE 2.335.1 x2` at 2026-09-24
    (16 days) with the ARC hint, `OK 2.337.0 x1 (published 2026-08-26)`, exit 1
    with `--fail-on-deprecation 30` and exit 0 without it.
  - `runners --repo actions/runner` -> real HTTP 403 -> `PERMISSION`, the
    Administration permission named, exit 0.
  - `runners --org github` -> real 403 -> `PERMISSION`, the org permission named.
  - No token -> real 401 -> `PERMISSION` with the set-GITHUB_TOKEN hint, exit 0.
  - `--repo` + `--org` -> exit 2. No scope at all -> exit 2.
    `--fail-on-deprecation soon` -> exit 2.
- **Acceptance criteria from the brief**, each checked: `node --test` green;
  `runners` exits 1 on the due fixture, 0 on the current one and 2 on the usage
  error; the permission fixture produces the named status and exit 0; `guard` on
  the self-hosted fixture without a token reproduces the 1.1.0 `::notice` byte
  for byte (asserted as a string equality, not a regex); the init/guard/plan
  byte-diff over the existing fixtures is clean.
- **Packaging.** `npm pack` -> 18 files, 49.1 kB. Installed from that tarball
  into a clean scratch dir with its own `package.json` and a relative spec
  (LESSONS 2026-09-01): `runner-drift --version` -> 1.2.0, `--help` shows
  `runners`, `import('runner-drift')` -> 98 exports including the whole runner
  lane, and a live `runners` run works from the installed bin.
- **The composite action, executed for real.** `action.yml`'s own `run:` body
  extracted and run with GitHub's env vars faked, across all seven input
  combinations including two real tarball installs: correct exit codes, seven
  annotations, repo-relative annotation paths, step summary written, `lock-file`
  output set, no `Unknown option` and no silent npx no-op. This is the technique
  that found the absolute-path bug, by running the action rather than reading it.
- **README shape checks.** The three fenced output blocks in the `runners` section
  are byte-compared against real CLI output, and the documented `runners --json`
  block is key-compared against a real survey (a test, so it cannot drift). Code
  fences balance, all 5 tables are well formed, both internal anchors resolve
  under `github-slugger`'s rules.
- **YAML.** `action.yml` and `ci.yml` both parse with `yaml.safe_load`;
  `action.yml`'s description is 113 characters (under the 125 Marketplace limit);
  the new CI assertions were extracted from the YAML and executed for real, all
  three branches.
- No TODO / FIXME / placeholder / mock anywhere in `src/`. `npm run lint` clean.

### Known gaps, stated rather than hidden

- **No real self-hosted fleet was ever listed.** This account owns none, and
  registering one on the owner's machine against a public repo would be a real
  security hazard (a public repo plus a self-hosted runner is arbitrary code
  execution from any PR), so it was not done. Consequence: in the populated
  end-to-end runs the *listing* half came from the schema-shaped fixture while
  every date, every deprecations response and every release date came from the
  live API. The empty-fleet path and both refusal paths are fully live.
- **`REGISTRATION-DUE` has never fired against the real API**, because the field
  is not populated yet. It is exercised by tests only.
- **Enterprise scope does not exist to implement.** Settled by measurement rather
  than left as a TODO: the 2026-09-03 changelog says the endpoint is callable at
  enterprise level, and `api.github.com` does answer
  `/enterprises/{slug}/actions/runners/deprecations/{v}` with a route-specific
  `documentation_url` (`#get-runner-version-end-of-life-schedule-for-an-enterprise`)
  where a bogus sibling path returns the generic one. But GitHub's published
  OpenAPI descriptions disagree: the `api.github.com` spec contains **only** the
  `/orgs/` and `/repos/` deprecations paths, and
  `/enterprises/{enterprise}/actions/runners` appears solely in the GHES spec,
  which has **no** deprecations path at all and is not covered by this
  enforcement. So there is nothing to call at enterprise scope on github.com or
  GHEC. `--enterprise` is absent by decision. Re-check if the
  `api.github.com` spec ever grows the path.
- **The workflow join only sees the checkout it is run in.** `runners --org acme`
  surveys the whole org but can only match `runs-on:` sites in the repository it
  is invoked from. That is the useful direction (which of *my* jobs stop), but it
  is not an org-wide impact report.
- **`detect()` runs more than once per `guard` invocation** (retirement scan,
  label fallback, tool fallback, and now the runner-lane join). The directories
  are a handful of small YAML files so it costs milliseconds, and threading one
  scan through every caller was judged more risk than it removes. Noted rather
  than hidden.

### Next features, in the order they are worth doing

1. **`--fail-on-deprecation` on `plan`**, so a migration preview covers both axes
   in one command.
2. **Group by runner group as well as version.** `runner_group_id` is captured on
   every runner already. An org with one stale group is a different remediation
   from a stale image tag.
3. **A `--max-age <days>` check against the release list.** The publication dates
   and the newest stable version are already fetched for the update target, so
   "this runner is four releases and 94 days behind and auto-update is off" is
   available before GitHub publishes any date for it.
4. **SARIF output**, if anyone asks. `gh-runner-eol` already does it, so it is
   only worth building to make one report cover both axes for code scanning.
5. **Enterprise scope**, if and only if the `api.github.com` OpenAPI description
   grows the path. See the gap above; today there is nothing to call.

### Deliberately not built

- **Source-file scanning for pinned runner versions** (Dockerfiles, Helm values,
  Terraform). That is `gh-runner-eol`'s lane and it does it well. Duplicating it
  would be the clone-the-neighbour pattern at product level.

### The 8-point bar

1. Feature-complete — **met**. Every capability the brief advertises works: both
   API calls, the version cache, the new command, all six statuses, the
   permission path, `guard` on self-hosted, and the action input.
2. No mocks/placeholders/fake data in the product — **met**. No shipped path
   touches a fixture. Sample data lives only under `test/fixtures/`, and the
   recorded API responses there are verbatim live.
3. Real end-to-end run — **met**, with the listing caveat above stated plainly
   rather than glossed.
4. Handles reality — **met**. Bad flag values, both scope flags at once, no scope,
   401, 403, 404 on the listing, 404 on a version, rate limit, network failure,
   malformed payload, empty fleet, null version, and a fleet past the page cap.
5. Tests — **met**. `node --test`, 219 passing, offline.
6. Publish-ready packaging — **met**, verified from a clean install.
7. README a stranger can follow — **met**. New section 5 with real output, the
   status table, the permission table, the lint-job snippet, the who-is-at-risk
   scoping, and both obsolete Limitations sentences rewritten.
8. Version — **met**. 1.2.0 in `package.json`, `action.yml` and `--version`.

---

## v1.1.0 (2026-08-12) — `--fail-on-retirement` + macOS-14 brownout data fix

Built per brief; Phase 0 re-verified all three sources live (issues 14254 and
13518 on runner-images, checkstyle#16793 for the real-world failure shape).
13518 confirms: eight brownouts 2026-10-05/-12/-16/-19/-23/-26/-29/-30, each
14:00-00:00 UTC, retirement 2026-11-02, plus the large/xlarge variants.

What changed:

- `src/labels.mjs`: macos-14/-arm64 brownout dates filled in (were `[]`); new
  `macos-14-large` / `macos-14-xlarge` DEADLINES rows (no LABEL_PATHS, so
  manifest lookups skip them cleanly); new exports `nextBrownout()`,
  `retirementStatus()`.
- `src/detect.mjs`: `extractLabelSites()`; `analyseWorkflow`/`detect` now also
  return `labelSites` ({label,file,line,col}, 1-indexed, col on the label text;
  no sites for self-hosted/floating; matrix expressions resolve to the matrix
  value positions).
- `src/report.mjs`: `retirementFindings` / `retirementAnnotations`
  (`::error file=,line=,col=`; `::warning` when only a brownout is inside the
  threshold) / `retirementSummaryMarkdown`.
- `src/cli.mjs`: `guard --fail-on-retirement=<days>`; runs before the
  ImageVersion skip so a plain lint job works; combined exit with drift; the
  retirement block rides into `--json`; flag absent = byte-identical to 1.0.2.
- `action.yml`: `fail-on-retirement` input; `version` default 1.1.0.
- New fixture `test/fixtures/workflows-retirement/pinned.yml` (macos-14 at
  12:14, ubuntu-22.04 at 30:14) in its OWN dir so the existing detect fixture
  counts stay valid. One existing test updated deliberately: report.test.mjs
  asserted the stale "macos-14 has no brownouts" data this release fixes.

VERIFIED (all run for real, 2026-08-12): 136/136 tests; worked example exact
(=60 → exit 1, one annotation at pinned.yml:12:14, 54/82 days; =10 → exit 0
clean; =250 → both labels, both stderr lines); `--help` shows the flag;
`--version` → 1.1.0; `npm pack` → 17 files; tarball installed into a clean
scratch dir → bin works, `import('runner-drift')` → 64 exports incl. the new
ones; action.yml parses, description 101 chars (<125); plain `guard` without
the flag unchanged.

**Release order (owner, from the phone), minding the ETARGET race (LESSONS
2026-08-05):** the CI step `uses: ./` requests npm `runner-drift@1.1.0` (the new
action default), which 404s until npm publish. So: (1) merge the PR when the
test/live/guard jobs are green. The "published action" step will fail with
`ETARGET` until 1.1.0 is on npm, which is expected pre-publish; (2) `npm publish`
from the merged main; (3) wait until `npm view runner-drift@1.1.0 version`
resolves, then re-run CI → all green; (4) tag `v1.1.0`, move `v1`, cut the
GitHub release (Marketplace tick needs your 2FA), release notes = the 1.1.0
CHANGELOG entry.

---

## Phase 0 — resource verification (all re-verified live before any code)

| Resource | Result |
| --- | --- |
| `raw…/images/ubuntu/Ubuntu2204-Readme.md` | HTTP 200. `OS Version: 22.04.5 LTS`, `Image Version: 20260720.234.2`, `Python 3.10.12`, `CMake 3.31.6`, `Clang: 13.0.1, 14.0.0, 15.0.7`, `Node.js 22.23.1`, `Git 2.54.0`, `Docker Client 28.0.4` — all present as quoted |
| `…Ubuntu2404-Readme.md` | HTTP 200. `24.04.4 LTS`, `20260720.247.2`, `Python 3.12.3`, `CMake 3.31.6`, `Clang: 16.0.6, 17.0.6, 18.1.3` — the real diff the brief promised |
| `…Ubuntu2604-`, `windows/Windows2022-`, `Windows2025-`, `macos/macos-14-`, `-15-`, `-26-` | all HTTP 200 |
| Arm paths | brief's guess `Ubuntu2204-arm-Readme.md` **404s**; the real names are `Ubuntu2204-Arm64-Readme.md` / `macos-15-arm64-Readme.md`, resolved via the contents API and used instead |
| `api.github.com/repos/actions/runner-images/commits?path=…&per_page=5` | HTTP 200 unauthenticated. Returned `3b7fa9c1…` (2026-07-27, "Updating readme file for ubuntu22 version 20260720.234.2"), plus `20260714.228.1`, `20260705.219.1`, `20260629.205.1`, `20260623.199.1` — exactly as quoted |
| Blob at an old SHA | `raw…/9a67eba4…/images/ubuntu/Ubuntu2204-Readme.md` HTTP 200, `Image Version: 20260623.199.1` |
| Issue #14254 | deprecation 2026-09-17, fully unsupported 2027-04-17, brownouts Mar 23 / Mar 30 / Apr 6 / Apr 13 14:00–00:00 UTC, targets ubuntu-24.04 / ubuntu-26.04 / ubuntu-latest |
| Issue #13518 | macOS 14: deprecation 2026-07-06, fully unsupported 2026-11-02 |
| Issue #13034 comments | 15 comments; erik-bershel 2025-09-30 "I'm forced to reject this feature request…" present |
| Cost | zero. Unauthenticated public endpoints only; `GITHUB_TOKEN` optional (rate limit). No account, no paid tier |

`LESSONS.md` read; nothing in it contradicts the brief. Applied from it: relative
tarball path when installing (#17), non-dot scratch folder with its own
package.json (#23), YAML validated with `yaml.safe_load` (#46).

## What is VERIFIED working

- `node --test` → **101 tests, 101 pass, 0 fail**, fully offline against four real
  downloaded manifest snapshots in `test/fixtures/`.
- `plan --from ubuntu-22.04 --to ubuntu-24.04 --workflows test/fixtures/workflows`
  against the **live** URLs prints the golden output: the image-version header line,
  the deadline + countdown, the `Python 3.10.12 -> 3.12.3  MINOR` row and the Clang
  set-diff row, and **omits CMake** (3.31.6 on both).
- Live `plan` also verified across families: `macos-14 -> macos-15` (real .NET SDK
  set diff + Git 2.54.0 → 2.55.0), `windows-2022 -> windows-2025` (genuinely no
  change — hand-checked against both manifests), `ubuntu-22.04-arm -> ubuntu-24.04-arm`.
- `guard` with no lock creates `runner-lock.json` and exits 0 ("baseline recorded").
- `guard` across a real four-image gap (20260623.199.1 → 20260720.234.2) reports
  Terraform 1.15.6 → 1.15.8 attributed to commit `f3d0fbf6` (image 20260714.228.1)
  and Kotlin 2.4.0-release-281 → 2.4.10-release-377 attributed to `3b7fa9c1`
  (20260720.234.2) — **per-tool** attribution, hand-verified against the manifests at
  each of the five SHAs. CMake suppressed.
- `guard` with no `ImageVersion` prints a `::notice` and exits 0.
- `--fail-on major` exits 1 on major drift, 0 on patch drift; default never fails.
- `npm pack` → 17 files, 28.5 kB, contains `src/`, `action.yml`, `README.md`,
  `CHANGELOG.md`, `LICENSE`.
- Installed from that tarball into a clean directory: `runner-drift --version` → 1.0.0,
  live `plan` works from the installed bin, `import('runner-drift')` exposes 58 names.
- All YAML (`action.yml`, `.github/workflows/ci.yml`, both fixtures) parses.
- No TODO / FIXME / placeholder / mock anywhere in `src/`.

## The 8-point bar

1. Feature-complete — **met** (all three subcommands, every advertised behaviour).
2. No mocks/placeholders/fake data — **met** (only real manifests; fixtures are real
   downloaded snapshots and live in `test/`).
3. Real end-to-end run on real input — **met** (outputs above and in the summary).
4. Handles reality — **met** (bad input, missing dir/file, empty result, 404, network
   failure, timeout, 403/429 rate limit, corrupt lock, self-hosted, floating labels).
5. Tests — **met** (`node --test`, 101 passing).
6. Publish-ready packaging — **met** (package.json, bin, exports, files, engines,
   keywords, license, repo; action.yml + branding at root; .gitignore; MIT LICENSE;
   verified installable from a clean path).
7. README a stranger can follow — **met** (problem, install, all three commands with
   real output, config tables, lock schema, limitations, first distribution step).
8. Version 1.0.0 — **met** (tagged `v1.0.0` locally).

## Shipped

| Step | Result |
| --- | --- |
| Public repo created | <https://github.com/Booyaka101/runner-drift>, topics set, issues on |
| `main` + tags pushed | `v1.0.0`, `v1.0.1`, moving `v1` → v1.0.1 |
| npm published | `runner-drift@1.0.0` then `@1.0.1`; `latest` = 1.0.1; MIT, bin wired |
| `npx runner-drift@latest` | verified from a clean dir against the public registry |
| GitHub releases | `v1.0.0` and `v1.0.1` with full notes |
| CI on real hosted runners | 3 runs, all green — 5 jobs each on ubuntu-24.04, windows-2025, macos-15 |
| Dogfood `guard` on a real runner | probed live: Node.js 22.23.1, Git 2.54.0, Docker Client 28.0.4, CMake 3.31.6 on ubuntu-24.04 image 20260720.247.2 — all matching the manifest |

### Why there is a v1.0.1

The Marketplace validator rejected the listing: **an `action.yml` description of 125
characters or more is refused.** Ours was 168. Shortened to 113 and released as a
patch so npm and git stay in sync. No behaviour change.

## Marketplace

Listed by the owner (the publish step is gated behind 2FA sudo mode, so it cannot be
automated): <https://github.com/marketplace/actions/runner-drift> — category
**Continuous integration**, secondary **Utilities**.

## Distribution (done 2026-08-05)

| Channel | Link | Why this one |
| --- | --- | --- |
| `actions/runner-images` **#13034** | [comment](https://github.com/actions/runner-images/issues/13034#issuecomment-5187164061) | The rejected "let me pin an image version" request. Named, frustrated users whose ask GitHub declined — the exact stranded population. Comment leads with the public mechanism, tool disclosed as ours at the end |
| `actions/runner-images` **#14254** | [comment](https://github.com/actions/runner-images/issues/14254#issuecomment-5187164459) | The `ubuntu-22.04` deprecation thread. Quiet today (3 comments) but it is where people land when they search the deprecation, and it will heat up as the 2027-03-23 brownouts approach. Comment leads with the real 22.04→24.04 delta table |
| dev.to | [article](https://dev.to/booyaka101/you-cant-pin-a-github-actions-runner-image-but-you-can-find-out-exactly-what-changed-58hm) | Long-form + search traffic. Tags: `githubactions`, `devops`, `opensource`, `ci` |
| X / @KillKenny101 | [post](https://x.com/KillKenny101/status/2084844881894375804) | Short announce, link card resolved |

**Deliberately skipped:** Hacker News (Booyaka101 has 3 karma — `/submit` bounces to
`story-toofast`) and Reddit (1 karma on the available account; r/devops-class subs
auto-remove below their karma floor). Posting there would be silently removed and burn
the account rather than reach anyone. Worth revisiting once those accounts have karma.

Done 2026-08-05: `actions/checkout` and `actions/setup-node` bumped `@v4` → `@v5` in
`.github/workflows/ci.yml`, clearing the Node 20 deprecation warning (v4 is
`using: node20`; v5, v6 and v7 are all `using: node24`). Latest upstream is v7 for
both if you ever want to go further; v5 is enough to silence the warning.

## Notes for a future maintainer

- **Deadline table is hand-maintained** (`src/labels.mjs`). There is no
  machine-readable feed; each entry prints its source issue URL. When GitHub
  announces the next retirement, add a `DEADLINES` entry and a `LABEL_PATHS` entry.
- **First-occurrence-wins is load-bearing** in `src/manifest.mjs`: the Ubuntu Android
  SDK table also has a `CMake` row (3.18.1/3.22.1/3.31.5), and the host CMake bullet
  (3.31.6) appears earlier in the document. Android tables are additionally skipped.
- **macOS spells it `Cmake`, Windows spells Node `Node`, Ubuntu lists JDKs in a
  name-less `| Version | Environment Variable |` table** — hence the candidate lists
  in `src/tools.mjs` and the case-insensitive lookup.
