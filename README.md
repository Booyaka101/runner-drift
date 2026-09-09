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

Since 1.2.0 it answers the same question about the other half of the fleet.
GitHub enforces a minimum self-hosted **runner agent** version, and the rule is
rolling: you have 30 days from each `actions/runner` release to install it, or
[the Actions service stops queueing jobs to your runner](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).
`runner-drift runners` reads the dates straight from GitHub's API and names the
runners that are about to go quiet. See
[Self-hosted agent versions](#5-runner-drift-runners--self-hosted-agent-versions).

- No account, no hosted service, no paid tier. Two endpoints only:
  `raw.githubusercontent.com` and `api.github.com`.
- The image lane runs unauthenticated; `GITHUB_TOKEN` only raises the rate limit.
  The `runners` lane is the exception: GitHub never serves the self-hosted runner
  endpoints anonymously, so it needs a token with administration read.
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

### 5. `runner-drift runners` — self-hosted agent versions

Two clocks run on a self-hosted runner. The image one does not apply, since you
built the machine. The **agent** one does. GitHub requires each new
`actions/runner` release to be installed within 30 days of publication, and the
docs state the consequence plainly: *"If you do not perform a software update
within 30 days, the GitHub Actions service will not queue jobs to your runner."*
Full enforcement on GitHub Enterprise Cloud was 2026-09-25 with brownouts from
2026-08-24, and GHEC with Data Residency was enforced on 2026-07-31
([timeline](https://github.blog/changelog/2026-06-12-github-actions-minimum-version-enforcement-timeline-for-self-hosted-runners/)).
GitHub Enterprise Server is not covered.

Because the rule is rolling there is no minimum to hardcode. `2.337.0` shipped on
2026-08-26 and the next release moves the mark again, so `runner-drift` asks
[the API GitHub added on 2026-09-03](https://github.blog/changelog/2026-09-03-github-actions-early-september-2026-updates/):
`GET /{scope}/actions/runners/deprecations/{version}`, one lookup per distinct
version, cached for the run. Twenty runners on one version cost one call.

The command needs no lock file and no runner of its own, so it runs as a plain
lint job. Three runners, two baked into a container image at `2.335.1` and one
auto-updating at `2.337.0`, on 2026-09-09. The dates below are the values the
live API returned that day, and they will have moved since:

```
$ runner-drift runners --org acme --fail-on-deprecation 30
self-hosted runners — acme (3 runners, 2 versions)
  RUNTIME-DUE   2.335.1  x2  arc-linux-1, arc-linux-2
                runtime support ends 2026-09-24 (16 days) — jobs stop being queued
                ephemeral runners — change the actions-runner-controller image tag, not the host
  OK            2.337.0  x1  build-mac-1  (published 2026-08-26)
                no end date returned — this version is current
note: self-hosted runners auto-update by default — at risk are the ones registered with --disableupdate, baked into a VM or container image, or pinned by actions-runner-controller
note: enforcement covers github.com and GitHub Enterprise Cloud, not GitHub Enterprise Server
source: GET /orgs/acme/actions/runners/deprecations/2.335.1
source: GET /orgs/acme/actions/runners/deprecations/2.337.0
runner-drift: 2 self-hosted runner(s) on 2.335.1 lose runtime support on 2026-09-24 (16 days) and --fail-on-deprecation 30 is set.
```

That last line goes to stderr and the run exits 1, with an `::error` annotation
and the same rows as a table in the job summary. Drop `--fail-on-deprecation` and the annotation becomes a
`::warning` and the exit code goes back to 0. Only that flag can change the exit
code, and `EXPIRED` is the one exception: a date already past always fails, the
same rule the image lane uses for a label past its retirement.

Most repositories have no self-hosted runners at all. That is the normal answer,
not a failure:

```
$ runner-drift runners --repo Booyaka101/runner-drift
self-hosted runners — Booyaka101/runner-drift (0 runners)
no self-hosted runners registered — nothing to check; GitHub-hosted runners are not affected
source: GET /repos/Booyaka101/runner-drift/actions/runners
```

#### The statuses

| Status | Means | Fails the job? |
| --- | --- | --- |
| `OK` | no end date returned, or both dates beyond the window | never |
| `RUNTIME-DUE` | `runtime_deprecates_at` inside the window. Jobs stop being queued | with `--fail-on-deprecation` |
| `REGISTRATION-DUE` | `registration_deprecates_at` inside the window. It keeps running what it has but cannot be re-created | with `--fail-on-deprecation` |
| `EXPIRED` | a date already past | always, whatever the threshold |
| `UNKNOWN-VERSION` | `version` is `null` (never connected), or the API does not recognise the string | never |
| `PERMISSION` | the endpoint was refused, plus the permission that would fix it | never (`::warning`, exit 0) |

`RUNTIME-DUE` and `REGISTRATION-DUE` are separate on purpose. A runner past its
registration date still finishes the jobs it has, it just cannot come back. Fold
the two together and an ephemeral or ARC fleet reads as healthy right up to the
next scale-down.

The window defaults to GitHub's own 30 days, so the plain report still tells you
what is coming. `--fail-on-deprecation <days>` sets the window *and* makes it
count against the exit code.

#### As a lint job

```yaml
  runner-versions:
    runs-on: ubuntu-latest
    steps:
      - run: npx runner-drift runners --org acme --fail-on-deprecation 30
        env:
          GITHUB_TOKEN: ${{ secrets.RUNNER_ADMIN_TOKEN }}
```

#### The permission, which is the part that trips people up

The self-hosted runner endpoints are never readable anonymously, and the default
`GITHUB_TOKEN` cannot read them either. You need one of:

| Scope | Fine-grained token | Classic token |
| --- | --- | --- |
| `--repo owner/repo` | "Administration" repository permission, read | `repo` |
| `--org name` | "Self-hosted runners" organization permission, read | `admin:org` |

Without one, `runner-drift` says which permission is missing and which endpoint
it tried, then exits 0. A missing permission is not a deprecation, so it never
fails your build on its own. It does emit a `::warning`, so the run is not
silently green either.

```
$ runner-drift runners --repo actions/runner --fail-on-deprecation 30
self-hosted runners — actions/runner
PERMISSION  GET /repos/actions/runner/actions/runners was refused (HTTP 403)
            A fine-grained token needs the "Administration" repository permission (read);
            a classic token needs the `repo` scope. The default GITHUB_TOKEN has neither.
```

#### Who is actually at risk

Self-hosted runners auto-update by default, so most fleets fix themselves and
this command reports `OK` forever. The population it exists for is the one
GitHub's own required-actions list names: runners registered with
`--disableupdate`, runners baked into VM or container images, and runners pinned
by `actions-runner-controller`. Two or more runners reporting the identical
version, or any runner marked `ephemeral`, is the tell, and `runner-drift` says
to change the image tag rather than telling you to SSH in and rerun `config.sh`.
There is no universal deadline here, only your fleet's.

`guard` uses the same lookup for the runner it happens to be running on. Give it
a token with administration read and it matches `$RUNNER_NAME` against the
listing and reports that runner's own dates in the summary table and `--json`.
Without a token, or without the permission, it prints the same `::notice` it
printed in 1.1.0 and exits 0. That is the common case, not an error path.

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
| `--org <name>` | `runners` | — | Organization to survey. Mutually exclusive with `--repo` |
| `--repo <owner/repo>` | `runners` | `$GITHUB_REPOSITORY` | Repository to survey |
| `--fail-on-deprecation <days>` | `runners`, `guard` | report only, window 30 | Set the window **and** fail when a runner version's support ends inside it |
| `--json` | all | off | Machine-readable output |
| `--no-summary` | `guard`, `runners` | on | Skip the `$GITHUB_STEP_SUMMARY` write |
| `--no-update-lock` | `guard` | on | Report drift but leave the lock file untouched |

Exit codes: `0` success (including "drift found" without `--fail-on`, a refused
permission, and an empty fleet), `1` drift at or above the `--fail-on` threshold,
a label inside the `--fail-on-retirement` window, a runner version inside the
`--fail-on-deprecation` window, or an `EXPIRED` runner version at any threshold,
`2` usage / configuration error.

### Action inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `fail-on` | `''` | `major`, `minor`, `any`; empty means report only |
| `fail-on-retirement` | `''` | Days ahead to fail on a label retirement or brownout; empty disables |
| `fail-on-deprecation` | `''` | Days ahead to fail on this self-hosted runner's own agent version; empty disables. Needs `github-token` to carry administration read |
| `tools` | `''` | Comma-separated override |
| `lock-file` | `runner-lock.json` | Lock file path |
| `workflows` | `.github/workflows` | Scanned when there is no lock yet |
| `version` | `1.2.0` | npm version of `runner-drift` to run |
| `github-token` | `${{ github.token }}` | Rate limit, plus the runner listing for `fail-on-deprecation` (which the default token cannot read) |

The action wraps `guard`. The fleet-wide `runners` command is a plain
`run:` step, shown [above](#as-a-lint-job).

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
- **Image deadlines are a hardcoded table; runner-version deadlines are not.**
  The `runs-on` label dates in `src/labels.mjs` are transcribed from
  [#14254](https://github.com/actions/runner-images/issues/14254) and
  [#13518](https://github.com/actions/runner-images/issues/13518) and printed with
  their source URL. GitHub publishes no machine-readable feed for those, so if it
  moves an image date the table needs a release. The self-hosted **runner agent**
  dates are the opposite: they come from
  `GET /{scope}/actions/runners/deprecations/{version}` on every run and are never
  stored, because the 30-day rule is rolling and any number baked into this package
  would be wrong by the next `actions/runner` release.
- **`registration_deprecates_at` is documented but not yet populated.** The
  [schema](https://docs.github.com/en/rest/actions/self-hosted-runners?apiVersion=2022-11-28)
  says string-or-null, and on 2026-09-09 the live API omitted the key entirely for
  every version from `2.325.0` to `2.337.0`, returning only
  `runtime_deprecates_at`. `REGISTRATION-DUE` is implemented and tested against
  that shape, and it will start firing the day GitHub fills the field in.
  Meanwhile a version below the `2.329.0` registration floor is called out on its
  own line.
- **Detection is a targeted line scan**, not a full YAML parse (the package has zero
  dependencies). It handles inline, flow-sequence and block-sequence `runs-on:`, and
  resolves `runs-on: ${{ matrix.os }}` by harvesting label-shaped values from the same
  file. If it misses something, `--tools` and `--label` override it completely.
- **Self-hosted runners have their own lane, not a skip.** There is still no
  `ImageVersion` to diff, so `guard` prints its `::notice` about the image, then
  checks the runner's own **agent** version against GitHub's dates. That needs a
  token with administration read; without one it falls back to the 1.1.0 behaviour,
  which is the `::notice` and exit 0. `runner-drift runners` covers the whole
  fleet at repo or org scope. Enterprise scope is not implemented: this package
  only ever talks to `/repos/…` and `/orgs/…`.
- **Source files are not scanned for pinned runner versions.** If your Dockerfile,
  Helm values or Terraform pins an `actions/runner` version, `runner-drift` will
  not find it there. It reads what your runners actually report. For the
  scanning angle, [`canblmz1/gh-runner-eol`](https://github.com/canblmz1/gh-runner-eol)
  already does it well and also covers enterprise scope.
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
node --test          # 201 tests, fully offline against recorded real fixtures
```

Tests run against four **real** manifest snapshots in `test/fixtures/`
(`Ubuntu2204` at two different image versions, `Ubuntu2404`, `macos-15`), so the
golden `plan` output is deterministic while the live path re-fetches. The runner
lane works the same way: `test/fixtures/runners/deprecations-recorded.json` is
the verbatim live response for eight versions, recorded 2026-09-09, so the dates
the tests assert on are GitHub's own. The fleet listings alongside it are built
to the documented schema, because this account owns no self-hosted runners to
record; the empty listing in the recorded file is real.

The runner tests stub `globalThis.fetch` rather than the module boundary, so
`src/runners.mjs` is exercised *through* `src/http.mjs` and the 401, 403, 404 and
rate-limit paths are the real ones.

## License

MIT — see [LICENSE](LICENSE).
