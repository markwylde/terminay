# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-16
- Reviewer: Claude (for Mark Wylde)
- Change: github-worktree-status

## In-Force ADR Context Reviewed

- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md - the GitHub extension publishes the same typed facts into host-issued contexts, so no UI changes are needed. Its poll needs its own approval, recorded in design.md.
- openspec/adr/0028-no-polling-without-owner-approval.md - the GitHub refresh (10 s active, 45 s inactive, at once on focus) is a new poll. The owner approved it on 2026-10-16, design.md records it, and the timer site cites it. Waiting for the rate-limit reset is a bounded retry. `hosts.yml` is watched.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md - `gh auth token` runs at most once per host per token lifetime and never from a refresh. ADR-0063 records this.
- openspec/adr/0011-security-trust-boundary-model.md - trusted extension. Properties are text plus credential-free HTTPS links, and tokens stay in the child.
- openspec/adr/0003-vault-interface-and-key-protectors.md - sign-in tokens use the existing per-origin vault binding.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md - GitHub requests run on the server that owns the project.
- openspec/adr/0026-extensions-may-ship-prebuilt-native-modules.md - not needed. There are no native dependencies, and no keychain module because `gh` reads the keychain.

## Repository-Level ADRs Created

- openspec/adr/0063-a-forge-extension-may-ask-the-forge-cli-for-a-token-once-never-per-refresh.md - a forge extension may run its forge's CLI to obtain a token only when the CLI's file shows a login without one, once per origin per token lifetime, and never on the refresh path.

## Notes

- One row was added to the README index. No prior ADR file was edited.
