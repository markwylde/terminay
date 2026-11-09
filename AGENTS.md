# AGENTS — Terminay

Terminay is a local-first Electron terminal workspace. Product behaviour is
specified with [OpenSpec](https://github.com/Fission-AI/OpenSpec) in `openspec/`;
read the relevant capability spec before changing code.

## Where things live

- `openspec/specs/<capability>/spec.md` — the canonical product contract, one
  capability per directory. Present tense, `### Requirement:` with at least one
  `#### Scenario:` each.
- `openspec/changes/<name>/` — work in progress or awaiting verification and
  archive. Each holds
  `proposal.md`, `design.md`, `adr.md`, `tasks.md`, and `specs/<capability>/spec.md`
  deltas.
- `openspec/changes/archive/<date>-<name>/` — completed changes, kept as history.
- `openspec/adr/` — durable architecture decision records, plus `evidence/` for
  the spikes and measurements behind them. See `openspec/adr/README.md`.
- `docs/product-overview.md` — product purpose, core model, architecture
  boundaries.
- `docs/operations/` — operator runbooks for standalone and embedded servers.

`openspec/config.yaml` carries the project context and the per-artifact rules
that apply to everything above. It selects the `spec-driven-with-adr` workflow,
whose schema is vendored at `openspec/schemas/spec-driven-with-adr/`.

## Working agreement

- Work capability-first. Propose a change (`/opsx:propose`, or the
  `openspec-propose` skill) before changing product behaviour; implement it with
  the apply workflow; archive it when done so its deltas fold into the main specs.
- Keep planning artifacts, implementation, verification, and spec sync in the
  same worktree and pull request. A proposal does not need a separate commit,
  pull request, or merge to `main` before implementation. Use a separate
  proposal review only when requested.
- A main spec states the required contract as though it had always been that way.
  Never write legacy, deprecated, transitional, migration, or cleanup framing into
  `openspec/specs/` — that belongs in a change.
- Never edit an accepted ADR. Record a new one that supersedes it.
- Validate with `openspec validate --all` (add `--archived` to cover the archive,
  which `--all` does not walk).

## Remotes and CI

- **`origin` is the canonical repository**: a self-hosted Gitea at
  `ssh://git@git.i.wylde.net:4222/markwylde/terminay.git`. Branches, pull
  requests, reviews, and CI all live there. Drive it with the `tea` CLI.
- **`github` is a mirror, not a destination.** `https://github.com/markwylde/terminay.git`
  carries a repository ruleset that forbids creating refs, so pushing a new
  branch to it is rejected with `Cannot create ref due to creations being
  restricted`. Never open a pull request there, and never read CI status from
  it. `gh` is the wrong tool for this repository.
- **Pull-request CI is `.gitea/workflows/`**, not `.github/workflows/`.
  `ci.yml` triggers on `pull_request` and publishes
  around twenty commit statuses on the head SHA, including ten sharded E2E jobs
  and a packaged macOS startup smoke. `.github/workflows/` holds mirror-side
  release plumbing that fires only on push to `main`, on tags, or on dispatch —
  the absence of a `pull_request` trigger there says nothing about whether a
  pull request is gated.
- A pull request is not finished until those statuses are read back and every
  one is `success` or `skipped`. Opening a pull request and reporting its number
  is not evidence that anything passed.

## Engineering boundaries

- Keep Electron privileged. Renderer code uses the preload API; filesystem,
  PTY, secrets, Git, and network services stay in `electron/`.
- Preserve the project/window and terminal-session boundaries. They are security
  boundaries for remote access, MCP, and agent status.
- Agents must run Electron end-to-end tests through `npm run test:e2e`, which
  isolates Electron, Chromium, and Xvfb in Docker. Never run Playwright's
  Electron suite directly on the host unless the user explicitly requests it;
  `npm run test:e2e:host` is reserved for isolated CI runners.

## Running Node tests locally

A broken local install makes some suites hang forever instead of failing.
Agents have repeatedly stalled for hours on this.

- **Install with `npm ci`, never `npm ci --ignore-scripts`.** The root
  `postinstall` (`scripts/ensure-node-pty-helper-mode.mjs`) makes node-pty's
  `spawn-helper` executable. Without it, every PTY spawn fails with
  `posix_spawnp failed`. The session-holder and terminal-service tests then
  fail, the holders they started stay alive, and `node --test` never exits. If
  a worktree was installed without scripts, run
  `node scripts/ensure-node-pty-helper-mode.mjs` before testing.
- **Build workspace dependencies first.** A package's tests import other
  packages' `dist/`. Run `npx turbo run build --filter=<package>...` before its
  tests. `ERR_MODULE_NOT_FOUND ... /dist/index.js` means a dependency wasn't
  built, not that the change is broken.
- **Always bound a test run by wall-clock time.** `--test-timeout` does not
  catch a process kept alive by leaked handles after its tests finish. Run
  suites under `timeout` (for example `timeout 900 node --test test/*.test.mjs`)
  and treat exit 124 as a hang to investigate.
- **Never wait idle on a background test run.** If it hasn't reported within
  the time you expect, check `pgrep -fl "node --test"` and its log, name the
  stuck file, and kill only the processes you started.
