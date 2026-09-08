## 1. Package scaffold

- [x] 1.1 Create `apps/terminay-cli` (npm name `terminay`, `bin: { terminay: dist/cli.js }`, `engines.node >=20`, dependency `qrcode` pinned exactly, `private` unset) and add it to the root workspaces, turbo graph, `scripts/check-workspace-boundaries.mjs`, and the deterministic-build check; verified by `npm run check:boundaries`, `npm run typecheck:workspaces`, and `npm run check:deterministic-artifacts` passing
- [x] 1.2 Implement the argument parser for `daemon install|uninstall|start|stop|status|upgrade|qr-code|pairing-url|approvals|approve|deny|reset-identity` with `--system`, `--user`, `--run-as`, `--port`, `--direct-origin`, `--hosted-domain`, `--expose`, `--project-root`, `--allow-downgrade`, `--purge`, `--yes`, `--no-wait`, `--mode`, and `--help`; verified by parser unit tests covering every command, alias, unknown flag, and missing value
- [x] 1.3 Implement the platform gate (Linux, x64 or arm64, `/run/systemd/system` present) with the exact refusal message; verified by unit tests that stub `process.platform`, `process.arch`, and the filesystem

## 2. Version resolution and verification

- [x] 2.1 Implement `resolveRef` for latest, `vX.Y.Z`, `main`, and branch or commit, returning channel, version, revision, published time, and asset URLs for the host architecture, with `GITHUB_TOKEN` support and the release-page fallback; verified by unit tests against recorded GitHub API and HTML fixtures, including the missing-architecture failure
- [x] 2.2 Implement `downloadAsset` with a streaming SHA-256, resumable temp file under the prefix, and cleanup on failure; verified by a test against a local HTTPS server serving a fixture archive
- [x] 2.3 Embed the release public key as a PEM constant and implement `verifyArchive` (sidecar hash, then Ed25519 signature) with no bypass; verified by tests for valid, wrong hash, wrong signature, and wrong key, and by `scripts/release-signature.mjs` signing the fixture used in the tests
- [x] 2.4 Add a CI check comparing the embedded key with `TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64`; verified by `scripts/release-config.test.mjs` extended with a mismatch case

## 3. Install layout and systemd integration

- [x] 3.1 Implement `installArchive` that unpacks into `versions/<version>`, verifies the manifest with `scripts/standalone-artifact.mjs` logic, and writes `install.json`; verified by tests on a temporary prefix checking layout, permissions, and manifest rejection
- [x] 3.2 Implement `activate` and `rollback` with `current.tmp` plus `rename`, and `retain` keeping the active and one previous version; verified by tests that interrupt between steps and assert `current` always points at a complete version
- [x] 3.3 Implement the systemd adapter (`daemon-reload`, `enable --now`, `start`, `stop`, `disable`, `is-active`, `--user` variants, `loginctl enable-linger`, journal tail) as a thin wrapper over `systemctl` found on `PATH`; verified by tests with a fake `systemctl` script recording invocations
- [x] 3.4 Implement the unit and environment-file templates for system and user scope with the runbook hardening and the default variables from design D7, writing the server id once and never rewriting it; verified by golden-file tests for both scopes and a test that reinstall preserves an existing server id
- [x] 3.5 Implement scope and run-as selection: TTY prompts with preselected defaults, non-TTY flag requirement, root check for system scope, `useradd` for the dedicated account, existence check for `--run-as`, data-root creation with 0700 and ownership; verified by tests driving the prompts through a fake stdin and a fake `useradd`
- [x] 3.6 Implement primary-address discovery for the default direct origin with `--direct-origin` override; verified by a unit test that stubs the UDP socket and by the override path

## 4. Commands

- [x] 4.1 Implement `daemon install [ref]` composing resolution, download, verification, install, unit write, enable, and readiness wait, printing the derived direct origin and next steps; verified by an end-to-end test on a temporary prefix with fake `systemctl` and a local release server, and by the source-build path in 4.7
- [x] 4.2 Implement `daemon upgrade [ref]` following the installed channel, refusing downgrades without `--allow-downgrade`, and performing stage, stop, switch, start, readiness, rollback, retain; verified by tests for tag-to-tag, main-to-main by revision, refused downgrade, and readiness failure with rollback
- [x] 4.3 Implement `daemon start`, `daemon stop`, and `daemon status` (unit state, version, channel, redacted `--status`, `/readyz`, exposure modes); verified by tests with fake `systemctl` and a fake health server, and a redaction test that no path or device field appears
- [x] 4.4 Implement `daemon uninstall` with `--purge` confirmation; verified by tests asserting the data root survives by default and is removed only after confirmation or `--yes`
- [x] 4.5 Implement `daemon qr-code` and alias `daemon pairing-url`: socket `pairing` lookup, terminal QR for the preferred or `--mode` URL, URL and expiry printing, approval polling with Y/n prompt, room refresh near expiry, `--no-wait`, and the re-execution as the run-as user for the socket; verified by tests against a fake approval socket that scripts pending, approved, denied, and rotate sequences, and a test that no host or device key is ever printed
- [x] 4.6 Implement `daemon approvals`, `daemon approve <id>`, `daemon deny <id>`, and `daemon reset-identity` (stop, rotate, start, with confirmation); verified by tests with the fake socket and fake `systemctl`
- [x] 4.7 Implement the source-build fallback: toolchain preflight, shallow clone, pinned Node download by the repository's recorded hash, archive build with `--channel source`, install through `installArchive`, temp-dir retention on failure; verified by a test with fake `git` and a fixture builder, and by one opt-in real build test gated behind `TERMINAY_RUN_SOURCE_BUILD_E2E=1`

## 5. Release and documentation

- [ ] 5.1 Add the npm publish job to `.github/workflows/trigger-release.yml` after archive attachment, setting the CLI version from the tag and running the key check before `npm publish --provenance --access public`; verified by `scripts/release-artifact-build-contract.test.mjs` extended to assert job order and by a dry-run publish on a branch
- [ ] 5.2 Add an opt-in container smoke on a systemd-enabled image that runs `daemon install <local archive>`, `status`, `upgrade`, `qr-code --no-wait`, and `uninstall`; verified by the smoke passing when `TERMINAY_RUN_DAEMON_SMOKE=1`
- [ ] 5.3 Rewrite the install and upgrade sections of `docs/operations/standalone-server.md` to lead with `npx terminay daemon …`, keep the manual unit as fallback, and document scope, run-as, direct origin, and the QR approval loop; verified by review against the `daemon-cli` spec
- [ ] 5.4 Run `openspec validate --all`, `npm run smoke:workspaces`, and the new CLI test suite; verified by all passing in CI
