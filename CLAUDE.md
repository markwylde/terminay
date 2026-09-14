# CLAUDE.md

Read [AGENTS.md](./AGENTS.md) first and follow it. It is the authoritative
working agreement for this repository — where specs, changes, and ADRs live,
the capability-first OpenSpec workflow, the engineering and security
boundaries, and how this repository's remotes and CI actually work.

Two things from it are worth repeating here, because getting either wrong
wastes a whole review cycle:

- **`origin` is a self-hosted Gitea instance and is canonical. `github` is a
  mirror** that rejects new branches. Pull requests and CI live on Gitea; use
  the `tea` CLI, not `gh`.
- **Pull-request CI is defined in `.gitea/workflows/`.** `.github/workflows/`
  has no `pull_request` trigger and says nothing about whether a pull request
  is gated. Read the commit statuses back before calling a pull request green.
