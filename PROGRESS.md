# PROGRESS — runner-drift

**Status: v1.1.0 PUBLISHED.** PR #1 merged to main (rebased, `00ea325`),
`runner-drift@1.1.0` live on npm as `latest`, and CI on the merged commit is
green on all five jobs including the `uses: ./` step that installs the
published package on ubuntu, windows and macOS.

**Not done yet:** git tag `v1.1.0`, moving the `v1` tag, and the GitHub release.
Consumers on `Booyaka101/runner-drift@v1` still get the 1.0.2 action.yml, which
works but has no `fail-on-retirement` input. The Marketplace step needs 2FA.

- Repo: <https://github.com/Booyaka101/runner-drift>
- npm: <https://www.npmjs.com/package/runner-drift> (latest: `1.1.0`)
- Releases: `v1.0.0`–`v1.0.2`; moving tag `v1` still → v1.0.2

Date: 2026-08-12

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
