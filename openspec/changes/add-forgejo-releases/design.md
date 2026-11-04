## Context

The canonical repository runs CI on macos and ubuntu-latest labels. GitHub Trigger Release contains signing, notarization, glibc-floor and packaged startup checks, but uses GitHub-specific release APIs and artifact storage. Desktop updater configuration points at GitHub. ADR-0027 retains that contract; ADR-0016 standalone channels are outside this change. Existing ADRs were reviewed through their Supersedes links; no accepted ADR is edited.

## Goals / Non-Goals

Goals: independent desktop release builds, complete verified publication, recoverable drafts, and no Windows dependency on the canonical forge.
Non-goals: moving hosts, Windows VMs, changing GitHub releases/updaters, rolling prereleases, or adding standalone server archives.

## Decisions

- Dispatch on main without version inputs. Reuse getNextVersion from scripts/release-utils.mjs with the latest stable tag and intervening commit messages, matching GitHub version rules. Pin both platform checkouts to the dispatch SHA, and create/verify the tag through the forge API. Reuse a stable tag already at this commit to resume a matching draft; a matching workflow-owned published release is a successful no-op. Existing conflicting tags or foreign releases still fail closed. The forges share tag names through mirroring but publish independently.
- Reuse the GitHub platform build and validation steps in the forge workflow, with macos selecting native arm64 and ubuntu-latest selecting native x64. Linux uses the floor container; macOS requires the existing Apple secrets and signing identity. No unsigned fallback. The macOS VM uses a shell step to install the pinned, checksum-verified Node archive into RUNNER_TEMP: actions/setup-node terminated its runner transport with a broken pipe during run 23419. Linux retains setup-node. The packaged macOS CI lane executes the same installer script so its successful run verifies this setup on the release runner before merge.
- Use a small Node API client scoped to the current repository and workflow token. This crosses the release-publication boundary only. The client creates a draft, uploads only reviewed filenames with SHA-256 sidecars, compares duplicate uploads for safe retries, and publishes after downloading and verifying the complete macOS/Linux asset inventory. Do not depend on GitHub artifact services or gh.
- GitHub remains the updater provider inside both independently built apps. Generated metadata is validated during packaging but is not advertised as a separate update feed on the canonical forge.

## Risks / Trade-offs

- Missing Apple secrets or native runner tools block release → fail with explicit preflight checks; document setup.
- Drafts and tags survive failed builds → retry the same tag/commit; refuse published-release mutations and conflicting bytes.
- Duplicated workflow checks can drift → contract tests compare platform verification steps with the GitHub workflow.
- Builds still download dependencies/actions → independent of GitHub release production, not a fully offline supply chain.

## Migration Plan

Install the workflow and client, configure existing Apple secrets/variables, dispatch a chosen version on main, and verify both public download sets. Disable the new workflow to roll back; GitHub and installed-app feeds remain operational.

## Open Questions

Live canonical-forge signing credentials and release API token permissions require validation during the first dispatched release. No Windows infrastructure is required.
