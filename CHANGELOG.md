# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] — 2026-08-05

### Fixed

- The action failed with `sh: 1: runner-drift: not found` (exit 127) when run
  inside a checkout whose own `package.json` is named `runner-drift` at the same
  version the action requests — i.e. this repo dogfooding itself. `npx` resolves
  a bin against the current directory's `package.json` first, decides the package
  is already present, looks for `node_modules/.bin/runner-drift`, and dies before
  any install has happened. It worked in every other repo, which is why it went
  unnoticed until the guard ledger surfaced the red run.
  The action now invokes `npx` from an empty temp directory and passes absolute
  paths for `--lock-file` and `--workflows`. Note `npx --package=` does **not**
  fix this — it is the working directory that decides, not the package spec.

## [1.0.1] — 2026-08-05

### Fixed

- `action.yml`'s `description` was 168 characters; the GitHub Marketplace rejects
  anything 125 or longer, so the listing could not be published. Shortened to 113.

### Changed

- `action.yml` `version` input now defaults to `1.0.1`.

[1.0.1]: https://github.com/Booyaka101/runner-drift/releases/tag/v1.0.1

## [1.0.0] — 2026-08-05

First release.

### Added

- **`runner-drift init`** — scans `.github/workflows/*.y[a]ml`, detects the
  `runs-on:` labels and the tools your `run:` steps actually invoke, and writes
  `runner-lock.json` from the live runner-images manifest for that label.
- **`runner-drift guard`** — runs inside a workflow. Reads the runner's
  `ImageVersion` / `ImageOS`, probes the real installed version of each locked
  tool (falling back to the image manifest for tools with no probe recipe),
  diffs against the lock, attributes every change to the `actions/runner-images`
  commit that shipped it, writes a markdown table to `$GITHUB_STEP_SUMMARY` plus
  `::warning` annotations, updates the lock, and exits 0 — exiting 1 only under
  `--fail-on major|minor|any`.
- **`runner-drift plan --from <label> --to <label>`** — fetches both image
  manifests, intersects them with the tools your workflows use, prints only the
  affected rows plus a countdown to the source label's retirement date.
- Composite GitHub Action at the repo root (`action.yml`) wrapping `guard`,
  with `fail-on`, `tools`, `lock-file` and `workflows` inputs.
- Manifest parser covering every shape the real readmes use: `CMake 3.31.6`,
  `Clang: 13.0.1, 14.0.0, 15.0.7`, `AzCopy 10.32.4 - available by …`,
  bare-version lists under `#### Go`, `| CMake | 3.22.1<br>3.31.5 |` tables, and
  the name-less `| Version | Environment Variable |` Java table.
- `ImageVersion -> SHA` index built from runner-images rollout commit messages,
  with blob-at-SHA snapshots and a nearest-earlier-commit fallback for when the
  readme lags the rollout (rows are labelled *approximate*).
- Deprecation deadline table for `ubuntu-22.04` (+ arm) and `macos-14`, each
  printed with its source issue URL.
- Clean skips with a clear message for: self-hosted runners, unknown labels,
  labels whose manifest path 404s, floating labels (`ubuntu-latest`), zero
  detected tools, a missing workflow directory, and API rate limiting.

[1.0.0]: https://github.com/Booyaka101/runner-drift/releases/tag/v1.0.0
