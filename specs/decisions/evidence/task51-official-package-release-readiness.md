# Task 51 official package release readiness audit

Audited 2026-08-12 without publishing, reserving names, configuring trusted
publishers, or otherwise mutating npm/Git hosting.

## Result

Official publication is **not yet ready**. The release checklist must remain
unchecked until the external bootstrap and CI evidence below exist.

Registry lookups returned not-found for `@terminay/extension-api`,
`terminay-plugin-ssh`, and `terminay-plugin-puzed`. A user npm configuration
contains a token-shaped entry, but `npm whoami` did not authenticate; no usable
local publishing credential was found. Token contents and account identity were
not printed or recorded.

Both extension worktrees pack a bounded inventory (`terminay-plugin-ssh@0.1.0`:
65,961 bytes; `terminay-plugin-puzed@0.1.0`: 66,302 bytes), but neither repository
has a Git remote or `.github/workflows` release workflow. Both package manifests
lack the public `repository` metadata required for provenance. Puzed additionally
locks `@terminay/extension-api` to a sibling `file:` path, which the release
verifier now rejects and which cannot be reproduced from an independent
checkout. SSH declares only an optional peer and therefore does not install the
conformance/release tooling required by the workflow. SSH otherwise passes
double-pack verification after the verifier's license inventory correctly
falls back to the installed package metadata when npm's lock entry omits the
dependency's legacy `licenses` array; Puzed correctly fails on its local API
specifier until that dependency is published.

## Required release sequence

This is supporting evidence for the single release-supply-chain checkbox in
Task 51. These are ordered release steps, not independent product tasks, so
they deliberately use a numbered list rather than task checkboxes.

1. Choose public GitHub repositories and add exact `repository.url` metadata.
2. Publish a reviewed, inert bootstrap version of `@terminay/extension-api`;
  configure its trusted publisher; then publish the real API release through
  OIDC CI with provenance.
3. In each extension repository, replace local/optional-only API setup with
  the exact registry API version as a development dependency and regenerate
  `package-lock.json` in a fresh clone using Node 24.15.0/npm 12.0.2.
4. Copy `official-extension-release.yml` into each repository, commit it,
  reserve each package name with an inert bootstrap version, and configure npm
  trusted publishing for the exact repository/workflow with `npm publish`
  permission.
5. Run each workflow with `publish: false`; review tests, conformance, exact
  packed inventory, double-pack SHA-256, production dependency integrity,
  SPDX SBOM, license inventory, permissions, and compatibility.
6. Run `publish: true` from the reviewed immutable commit without an npm
  token. Preserve the CI evidence artifact even on failure.
7. Require `npm-registry-proof.json` to match the local tarball integrity and
  contain npm HTTPS provenance attestations for the exact version.
8. Install the exact registry versions into a clean supported Terminay Server
  and retain packed activation plus registry-unavailable failure evidence.

The authoritative commands and workflow are documented in
`packages/extension-api/docs/publishing.md`. npm trusted publishing requires an
existing package, so the first-name reservation is necessarily an explicit
interactive 2FA bootstrap; subsequent real releases use OIDC.
