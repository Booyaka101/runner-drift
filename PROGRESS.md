# PROGRESS — runner-drift

**Status: v1.0.1 SHIPPED.** Published to npm, repo public, CI green on real hosted
runners, releases cut for v1.0.0 and v1.0.1.

**One step left, and it needs you:** the GitHub Marketplace listing is gated behind
2FA sudo mode. See "Left for the owner" at the bottom — it is a 30-second job.

- Repo: <https://github.com/Booyaka101/runner-drift>
- npm: <https://www.npmjs.com/package/runner-drift> (`1.0.0`, `1.0.1`; latest `1.0.1`)
- Releases: `v1.0.0`, `v1.0.1`; moving tag `v1` → v1.0.1

Date: 2026-08-05

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

## Left for the owner (blocked on your 2FA — I will not touch a second factor)

1. **Publish the Action to the GitHub Marketplace.** Everything else is done and the
   validator now passes with no errors. Open
   <https://github.com/Booyaka101/runner-drift/releases/edit/v1.0.1>, tick
   **"Publish this Action to the GitHub Marketplace"**, set primary category
   **Continuous integration** and secondary **Utilities**, then **Update release**.
   GitHub will ask for your authenticator code (sudo mode) — that is the only reason
   this step is not already done. `action.yml` already carries
   `branding: { icon: activity, color: orange }` at the repo root.
2. **First distribution step** (also in the README): comment in
   <https://github.com/actions/runner-images/issues/14254>. That thread is where the
   stranded `ubuntu-22.04` population already is.

Optional: `actions/checkout@v4` and `actions/setup-node@v4` emit a Node 20
deprecation warning on current runners. Harmless today; bump to `@v5` when convenient.

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
