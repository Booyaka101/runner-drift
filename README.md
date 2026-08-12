# runner-drift

[![npm](https://img.shields.io/npm/v/runner-drift?color=cb3837&logo=npm)](https://www.npmjs.com/package/runner-drift)
[![Marketplace](https://img.shields.io/badge/Marketplace-runner--drift-2ea44f?logo=github)](https://github.com/marketplace/actions/runner-drift)
[![ci](https://github.com/Booyaka101/runner-drift/actions/workflows/ci.yml/badge.svg)](https://github.com/Booyaka101/runner-drift/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](package.json)

**Your CI is pinned to `actions/checkout@v5` and `node@22`. It is not pinned to the
compiler.** GitHub rebuilds the hosted runner images roughly weekly and you cannot
select an older one — [the feature request was rejected](https://github.com/actions/runner-images/issues/13034#issuecomment-3350116604)
("there's no technical feasibility for implementation yet"), and GitHub staff have
said plainly that [it's impossible to specify an older runner image in a workflow](https://github.com/orgs/community/discussions/160655).
So when Clang, Python or CMake moves underneath you, the first sign is a red build
with no diff to blame.

`runner-drift` locks the tool versions your workflows actually use, diffs them on
every image bump, and names **the runner-images commit that shipped the change**.

It also answers the question every `ubuntu-22.04` user has right now — GitHub is
[deprecating that image from 2026-09-17, fully unsupported 2027-04-17, with four
brownouts starting 2027-03-23](https://github.com/actions/runner-images/issues/14254):
*what actually breaks if I move to `ubuntu-24.04`?*

```
$ npx runner-drift plan --from ubuntu-22.04 --to ubuntu-24.04
ubuntu-22.04 -> ubuntu-24.04 (images 20260720.234.2 -> 20260720.247.2)
ubuntu-22.04 is fully unsupported on 2027-04-17; brownouts begin 2027-03-23 (source: actions/runner-images#14254)
255 days left (230 until the first brownout) — deprecation began 2026-09-17; see https://github.com/actions/runner-images/issues/14254
brownout windows (14:00-00:00 UTC): 2027-03-23, 2027-03-30, 2027-04-06, 2027-04-13
announced migration targets: ubuntu-24.04, ubuntu-26.04, ubuntu-latest

Clang 13.0.1,14.0.0,15.0.7 -> 16.0.6,17.0.6,18.1.3  REMOVED: 13.0.1, 14.0.0, 15.0.7 / ADDED: 16.0.6, 17.0.6, 18.1.3
Python 3.10.12 -> 3.12.3  MINOR

2 of 3 detected tool(s) change; 1 unchanged (not shown)
```

That is real output against the live manifests. Note what is **not** there: CMake.
It is 3.31.6 on both images, so it is suppressed — the report is only the rows that
affect you, picked by scanning your own workflows for the tools your steps invoke.

- No account, no API key, no hosted service. Two endpoints only:
  `raw.githubusercontent.com` and `api.github.com` (unauthenticated; `GITHUB_TOKEN`
  is used purely for the rate limit if it happens to be set).
- Zero runtime dependencies. Node 22+, ESM.

---

## Install

```bash
npx runner-drift --help        # no install
npm i -D runner-drift          # or as a dev dependency
npm i -g runner-drift          # or globally
```

## Usage

### 1. `runner-drift init` — record a baseline

```bash
$ runner-drift init
Scanned 2 workflow file(s) in .github/workflows
Runner label: ubuntu-22.04 (image 20260720.234.2, 22.04.5 LTS)
Locked 3 tool(s): CMake, Clang, Python
Wrote runner-lock.json
Heads up: ubuntu-22.04 is fully unsupported on 2027-04-17 (https://github.com/actions/runner-images/issues/14254)
Preview the move:  runner-drift plan --from ubuntu-22.04 --to ubuntu-24.04
Next: add the guard step to your workflow (see the README) and commit runner-lock.json.
```

Commit `runner-lock.json`.

### 2. `runner-drift guard` — watch for drift in CI

Add the action to any job (it lives at the root of this repo, so it also works
straight from the Marketplace):

```yaml
      - uses: Booyaka101/runner-drift@v1
        with:
          fail-on: major        # omit to report only and never fail the job
```

Or call the CLI directly:

```yaml
      - run: npx runner-drift guard --fail-on major
        env:
          GITHUB_TOKEN: ${{ github.token }}
```

The first run records the baseline and exits 0:

```
baseline recorded — ubuntu-22.04 image 20260623.199.1
  Terraform: 1.15.6 (from manifest)
  Kotlin: 2.4.0-release-281 (from manifest)
  CMake: 3.31.6 (from manifest)
Wrote runner-lock.json. Commit it so the next image bump can be diffed.
```

A later run, after GitHub has rolled four new images:

```
::warning title=runner-drift: Terraform patch::Terraform drifted on ubuntu-22.04: 1.15.6 -> 1.15.8 (PATCH) — shipped by 20260714.228.1 https://github.com/actions/runner-images/commit/f3d0fbf668c2d437a5a5a03e75206801e22e5e62
::warning title=runner-drift: Kotlin patch::Kotlin drifted on ubuntu-22.04: 2.4.0-release-281 -> 2.4.10-release-377 (PATCH) — shipped by 20260720.234.2 https://github.com/actions/runner-images/commit/3b7fa9c1aa1efb5fc0ba4b443dcfa69f47f53434
ubuntu-22.04 image 20260623.199.1 -> 20260720.234.2
  Terraform 1.15.6 -> 1.15.8  PATCH  [20260714.228.1] https://github.com/actions/runner-images/commit/f3d0fbf668c2d437a5a5a03e75206801e22e5e62
  Kotlin 2.4.0-release-281 -> 2.4.10-release-377  PATCH  [20260720.234.2] https://github.com/actions/runner-images/commit/3b7fa9c1aa1efb5fc0ba4b443dcfa69f47f53434
```

…and the same thing as a table in the job summary:

## runner-drift

`ubuntu-22.04` image `20260623.199.1` → `20260720.234.2`

| Tool | Locked | Now | Change | Shipped by |
| --- | --- | --- | --- | --- |
| `Terraform` | 1.15.6 | 1.15.8 | 🟡 PATCH | [20260714.228.1](https://github.com/actions/runner-images/commit/f3d0fbf668c2d437a5a5a03e75206801e22e5e62) |
| `Kotlin` | 2.4.0-release-281 | 2.4.10-release-377 | 🟡 PATCH | [20260720.234.2](https://github.com/actions/runner-images/commit/3b7fa9c1aa1efb5fc0ba4b443dcfa69f47f53434) |

Four image versions shipped between the lock and the run, and each tool is pinned
to the *specific* one that changed it — not just "the newest image". `CMake` did
not move, so it is not in the table.

### 3. `runner-drift plan` — before you migrate

```bash
runner-drift plan --from ubuntu-22.04 --to ubuntu-24.04
runner-drift plan --from macos-14 --to macos-15 --tools python,node,dotnet
runner-drift plan --from ubuntu-22.04 --to ubuntu-26.04 --json
```

### 4. Fail before the brownout

Deprecated images get scheduled brownouts before removal: `macos-14` jobs fail
14:00-00:00 UTC on eight dates starting 2026-10-05, then the label disappears on
2026-11-02 ([#13518](https://github.com/actions/runner-images/issues/13518));
`ubuntu-22.04` follows the same script from 2027-03-23
([#14254](https://github.com/actions/runner-images/issues/14254)). The first
brownout looks exactly like flaky CI, and by then the fix is urgent.

`guard --fail-on-retirement <days>` scans your workflow files for pinned
`runs-on:` labels and fails while the migration is still routine. It needs no
lock file and no hosted runner, so it works as a plain lint job:

```yaml
  runner-retirement:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: Booyaka101/runner-drift@v1
        with:
          fail-on-retirement: 60   # or: npx runner-drift guard --fail-on-retirement 60
```

Each hit is a file annotation on the exact `runs-on:` line, with the dates, the
announced migration targets and the source issue:

```
::error file=.github/workflows/release.yml,line=12,col=14,title=runner-drift: macos-14 retires in 82 days::macos-14 is fully unsupported on 2026-11-02 (82 days); next brownout 2026-10-05 (54 days). Migrate to macos-15, macos-26, macos-latest. See https://github.com/actions/runner-images/issues/13518
runner-drift: macos-14 is fully unsupported on 2026-11-02 (82 days) and --fail-on-retirement 60 is set.
```

When only a brownout falls inside the threshold the annotation is a `::warning`
(`runner-drift: <label> deprecation`), but the job still fails: those are the
dates your builds break. The step summary gets a table (Label, Where, Next
brownout, Fully unsupported, Migrate to, Source), `--json` gets a `retirement`
block, and a label already past its date always fails, whatever the threshold.
`ubuntu-latest` and friends float past retirements, so they are never flagged;
neither is `self-hosted`. `runs-on: ${{ matrix.os }}` is resolved from the
matrix values in the same file.

## Configuration

### CLI

| Flag | Applies to | Default | Meaning |
| --- | --- | --- | --- |
| `--workflows <path>` | all | `.github/workflows` | Workflow directory **or** a single workflow file |
| `--lock-file <path>` | `init`, `guard` | `runner-lock.json` | Lock file location |
| `--tools <a,b,c>` | all | detected | Override detection. Aliases (`python`, `npx`, `clang++`, `g++`, `javac`, …) resolve to manifest names; anything else is matched against the manifest case-insensitively, so `--tools Terraform,Kotlin` works |
| `--label <label>` | `init` | detected | Explicit runner label |
| `--from` / `--to` | `plan` | — | Runner labels to compare (required) |
| `--fail-on <level>` | `guard` | never fail | `major`, `minor` or `any` |
| `--fail-on-retirement <days>` | `guard` | off | Fail when a pinned label retires or browns out within N days |
| `--json` | all | off | Machine-readable output |
| `--no-summary` | `guard` | on | Skip the `$GITHUB_STEP_SUMMARY` write |
| `--no-update-lock` | `guard` | on | Report drift but leave the lock file untouched |

Exit codes: `0` success (including "drift found" without `--fail-on`), `1` drift at
or above the `--fail-on` threshold or a label inside the `--fail-on-retirement`
window, `2` usage / configuration error.

### Action inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `fail-on` | `''` | `major`, `minor`, `any`; empty means report only |
| `fail-on-retirement` | `''` | Days ahead to fail on a label retirement or brownout; empty disables |
| `tools` | `''` | Comma-separated override |
| `lock-file` | `runner-lock.json` | Lock file path |
| `workflows` | `.github/workflows` | Scanned when there is no lock yet |
| `version` | `1.1.0` | npm version of `runner-drift` to run |
| `github-token` | `${{ github.token }}` | Rate limit only |

### `runner-lock.json`

```json
{
  "schemaVersion": 1,
  "label": "ubuntu-22.04",
  "imageOS": "ubuntu22",
  "imageVersion": "20260623.199.1",
  "tools": {
    "Python": { "versions": ["3.10.12"], "source": "probe", "command": "python3 --version" },
    "Clang":  { "versions": ["13.0.1", "14.0.0", "15.0.7"], "source": "manifest" }
  },
  "updatedAt": "2026-08-05T02:52:15.070Z"
}
```

`source` records *how* the version was observed. `guard` probes the tool directly
(`python3 --version`, `clang --version`, `java -version`, …) when it can, because a
manifest says what the image was **built** with while a probe says what your job
will actually **execute**. Tools with no probe recipe fall back to the manifest for
that exact image version, and the source is recorded so a source change is never
mistaken for a version change.

## Supported labels

`ubuntu-22.04`, `ubuntu-24.04`, `ubuntu-26.04` (+ `-arm`), `windows-2022`,
`windows-2025`, `macos-14`, `macos-15`, `macos-26` (+ `-arm64`).

Deadline data covers the images with an announced retirement date:
`ubuntu-22.04` (+ arm) and `macos-14` (+ arm64, `-large`, `-xlarge`). The
large/xlarge labels have no public manifest, so they get the retirement
countdown and `--fail-on-retirement`, not the tool diff. Every other label
diffs fine, it just has no countdown.

## Limitations

- **Floating labels are refused, on purpose.** `ubuntu-latest` / `macos-latest`
  are re-pointed by GitHub without notice, so `plan` will not guess what they
  mean — pass the concrete label. `guard` does not need to guess: it reads the
  real label from the runner's `ImageOS` env var at run time.
- **Deadlines are a hardcoded table**, transcribed from
  [#14254](https://github.com/actions/runner-images/issues/14254) and
  [#13518](https://github.com/actions/runner-images/issues/13518) and printed with
  their source URL. There is no machine-readable feed to consume; if GitHub moves a
  date, the table needs a release.
- **Detection is a targeted line scan**, not a full YAML parse (the package has zero
  dependencies). It handles inline, flow-sequence and block-sequence `runs-on:`, and
  resolves `runs-on: ${{ matrix.os }}` by harvesting label-shaped values from the same
  file. If it misses something, `--tools` and `--label` override it completely.
- **Self-hosted runners are a clean skip**, not a feature. No `ImageVersion`, nothing
  to compare; `guard` prints a `::notice` and exits 0.
- **Azure DevOps is out of scope**, even though the same images and the same
  deprecation apply there.
- **No auto-fix.** `runner-drift` tells you exactly what moved and who moved it; the
  migration is yours.
- **Multi-version probes report one version.** `clang --version` reports the default
  clang, while the manifest lists all three. That is why the `source` field exists —
  compare like with like.

## Development

```bash
git clone https://github.com/Booyaka101/runner-drift
cd runner-drift
node --test          # 136 tests, fully offline against real downloaded manifest fixtures
```

Tests run against four **real** manifest snapshots in `test/fixtures/`
(`Ubuntu2204` at two different image versions, `Ubuntu2404`, `macos-15`), so the
golden `plan` output is deterministic while the live path re-fetches.

## License

MIT — see [LICENSE](LICENSE).
