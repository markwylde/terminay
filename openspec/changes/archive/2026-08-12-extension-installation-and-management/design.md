## Context

See proposal.md. This change was delivered in phase 2, in parallel with environment-routed
project services, the project environment and extension UI, and the official Puzed extension
foundation. It depends on the extension API, manifest, and host contract already being in place.

## Goals / Non-Goals

Goals: every supported server installs, updates, rolls back, disables, and removes extensions
through one recoverable audited contract, without a system npm.

Non-Goals: allowing arbitrary package sources, running package scripts, or building native code
on the server.

## Decisions

- **A pinned npm installer ships with the server artifact.** Desktop-embedded, standalone x64 and
  arm64, and Docker servers all carry it, so extension installation never depends on a system npm
  or a compiler being present on the host.
- **Installation is sterile and npmjs-only.** Aliases, git, file, URL, and custom-registry
  specifiers are rejected. Scripts are disabled during staging, the dependency tree is validated
  within bounds, and missing integrity, bad symlinks, bad entrypoints, and native/build/
  install-script trees fail before activation.
- **Installation is transactional over immutable slots.** Resolve, preview, and confirm produce an
  exact lock and integrity record; staging writes an immutable slot; activation is atomic; a
  receipt records the outcome; and crash recovery plus cleanup restore a consistent state. A
  failed or interrupted install or update never changes the active version.
- **Updates are side-by-side and rollback is slot selection.** A retained known-good slot can be
  reselected exactly, with drain and restart around the switch. Rollback restores the extension's
  code, not any external action the extension already performed.
- **Removal is reference-aware and never cascades.** Enable, disable, and remove respect existing
  references, and removal is blocked from cascading into project, profile, secret, or
  external-resource deletion. Extension data is snapshotted under a namespace.
- **The official catalogue is hardcoded records, not a live index.** Official SSH and Puzed
  records resolve their exact npmjs versions and integrity through the ordinary preview and
  install path, so there is one code path. Offline or registry-unavailable is an actionable state
  rather than a silent failure.
- **Signature and provenance are informational.** They are reported as metadata, and a
  trusted-code warning is shown for custom packages, because an extension is a trusted Node
  program regardless of what its provenance metadata says.

## Risks / Trade-offs

- Restricting installation to npmjs excludes private registries and local development packages;
  this was accepted to keep the resolve path sterile and auditable.
- Rollback cannot undo external effects an extension has already caused, so the guarantee is
  limited to selecting an exact retained slot.
- Only managers may mutate extensions; browser and Desktop hosts store no package at all.
