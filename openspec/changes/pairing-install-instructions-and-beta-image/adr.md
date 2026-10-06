# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-03
- Reviewer: Claude (for Mark Wylde)
- Change: pairing-install-instructions-and-beta-image

## In-Force ADR Context Reviewed

- openspec/adr/0005-sandboxed-origin-bound-client-hosts.md - the shared UI is untrusted; the host passes its version as plain display data.
- openspec/adr/0018-one-workspace-bundle-many-server-connections.md - hosts stay protocol-blind; a beta Linux host on `main` is reconciled by per-connection compatibility.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md - the tag and rolling `main` channels the image now follows.
- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md - Desktop's beta channel and the `X.Y.Z-beta.N` version grammar reused for image tags.
- openspec/adr/0032-layered-registry-e2e-images-and-test-level-shards.md - the GitHub mirror runs publication workflows only; a beta image is a publication, not a verification lane.
- openspec/adr/0033-pinned-node-runtime-baseline-on-npm-12-2.md - the image build keeps the pinned toolchain on both native runners.
- openspec/adr/0034-no-media-relay-reachability-from-candidates-and-routing-hints.md - the networking model behind the commands the screen shows.
- Remaining in-force ADRs reviewed; not touched by this change.

## Repository-Level ADRs Created

- None: no major durable architectural decisions were introduced by this change.

## Notes

- Publishing an image for each beta extends the existing release channels (ADR-0016, ADR-0027) to one more artifact rather than establishing a new commitment.
- The CI contract "server image publication is versioned-release-only" is a test-level rule, replaced in design decision 7.
- `connections.rename` and `connections.forget` are two more closed actions inside the existing `connections` host capability (ADR-0005, ADR-0018). They add no capability, cross no new boundary, and keep origins and credentials in the host.
- Taking the client version from the Desktop bundle's build-time version relies on ADR-0018's commitment that Desktop runs its packaged bundle for every connection.
