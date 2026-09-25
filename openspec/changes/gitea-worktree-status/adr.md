# ADR Review Manifest

## ADR Review Completed

- Date: 2026-09-24
- Reviewer: Claude (for Mark Wylde)
- Change: gitea-worktree-status

## In-Force ADR Context Reviewed

- openspec/adr/0003-vault-interface-and-key-protectors.md: sign-in tokens are stored in the server vault as per-origin bindings.
- openspec/adr/0011-security-trust-boundary-model.md: the Gitea extension is a trusted Node program. Properties are text plus credential-free HTTPS links, delivered per project.
- openspec/adr/0017-one-server-type-every-project-executes-on-its-server.md: forge requests run on the server that owns the project.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md: the chips and the sign-in modal ship in the one workspace bundle.
- openspec/adr/0019-language-intelligence-from-server-hosted-language-server-extensions.md: the same pattern of a server-hosted extension behind a core-owned bounded surface.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md: the extension uses `fetch` only and never runs `tea`.
- openspec/adr/0028-no-polling-without-owner-approval.md: in force (supersedes 0022). The Gitea 60 s refresh is the one poll; the owner approved it on 2026-09-24, recorded in design.md, and the timer site cites it. The tea config file is watched, not polled.
- openspec/adr/0025-agent-sessions-come-from-a-machine-wide-detection-library.md: host-side scoping by project and worktree follows the same shape.
- openspec/adr/0026-extensions-may-ship-prebuilt-native-modules.md: not needed. The extension has no native dependencies.

## Repository-Level ADRs Created

- openspec/adr/0029-worktree-properties-are-host-owned-typed-facts.md: extensions publish a closed, typed set of worktree facts inside a host-issued repository context, and Terminay renders them. Forge sign-in is host-prompted and vault-bound per origin. Forge state refreshes on events first, with an owner-approved poll for Gitea.

## Notes

- The README index was updated with one new row. No prior ADR file was edited.
