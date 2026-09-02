# AGENTS — Terminay

Terminay is a local-first Electron terminal workspace. Product behaviour is
specified with [OpenSpec](https://github.com/Fission-AI/OpenSpec) in `openspec/`;
read the relevant capability spec before changing code.

## Where things live

- `openspec/specs/<capability>/spec.md` — the canonical product contract, one
  capability per directory. Present tense, `### Requirement:` with at least one
  `#### Scenario:` each.
- `openspec/changes/<name>/` — active, unimplemented work. Each holds
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
- A main spec states the required contract as though it had always been that way.
  Never write legacy, deprecated, transitional, migration, or cleanup framing into
  `openspec/specs/` — that belongs in a change.
- Never edit an accepted ADR. Record a new one that supersedes it.
- Validate with `openspec validate --all` (add `--archived` to cover the archive,
  which `--all` does not walk).

## Engineering boundaries

- Keep Electron privileged. Renderer code uses the preload API; filesystem,
  PTY, secrets, Git, and network services stay in `electron/`.
- Preserve the project/window and terminal-session boundaries. They are security
  boundaries for remote access, MCP, and agent status.
- Agents must run Electron end-to-end tests through `npm run test:e2e`, which
  isolates Electron, Chromium, and Xvfb in Docker. Never run Playwright's
  Electron suite directly on the host unless the user explicitly requests it;
  `npm run test:e2e:host` is reserved for isolated CI runners.
