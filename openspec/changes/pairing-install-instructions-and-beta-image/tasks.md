## 1. Image workflow

- [x] 1.1 Add `version` and `revision` inputs to `server-image.yml`'s `workflow_dispatch`, validated by a `plan` job against the beta version grammar, the default branch, and that branch's history before anything is built. Verified by the contract test in `scripts/ghcr-image.test.mjs`.
- [x] 1.2 Tag rules: a release tag publishes `X.Y.Z`, `X.Y`, `latest`; a dispatched beta version publishes that version and `beta`; no `v` prefix; `latest` never from a beta and `beta` never from a release. Verified by the contract test asserting each rule's condition.
- [x] 1.3 Build `amd64` and `arm64` on native runners, push by digest, and join them in a manifest job that applies the tags only when both succeeded. Verified by the contract test (no QEMU step, two native runners, one manifest job that needs both).
- [x] 1.4 Stamp the planned version through `OCI_VERSION` and `TERMINAY_CHANNEL`. Verified by the contract test.
- [x] 1.5 Confirm on the first published beta that `docker buildx imagetools inspect` lists both platforms and that the server in the image reports the beta version. Verified by recording both outputs in the pull request.

## 2. Prerelease publishes a beta image

- [x] 2.1 Add a final job to `main-prerelease.yml` that dispatches `server-image.yml` on the default branch with the beta version and its commit, after the prerelease assets are published, holding `contents: read` and `actions: write` only. Verified by the contract test.
- [x] 2.2 Replace "server image publication is versioned-release-only" in `scripts/provider-portable-ci.test.mjs` with the rule in design decision 7, and gate `scripts/ghcr-image.test.mjs` in `npm run smoke`. Verified by `npm run test:ci`.
- [x] 2.3 Confirm on the first beta that `markwylde/terminay:<beta version>` and the GHCR tag share one digest, `beta` points at it, and `latest` did not move. Verified by recording the three `imagetools inspect` results in the pull request.

## 3. Install commands

- [x] 3.1 Add `serverInstallCommands({ version })`, a pure function returning the image reference and every command, deriving stable, beta, or unknown from the version grammar. Verified by unit tests for `5.13.0`, `5.13.0-beta.214`, `0.0.0`, an absent version, and malformed ones.
- [x] 3.2 Pass the Desktop bundle's version to the Connections route as `appVersion`, on Desktop only. Verified by the Electron E2E in 4.3 and the browser E2E in 4.1.

## 4. Add connection section

- [x] 4.1 Render the section beneath the pairing field: the Docker and Linux host choice, two numbered copyable commands, the sentence pointing at the field above, the collapsed More options disclosure, and the link to the installation guide. Verified by `e2e/remote-control-management.spec.ts` for each scenario of "Add connection shows how to start a server".
- [x] 4.2 Keyboard and assistive-technology behaviour: the choice is a radio group moved by arrow keys, copy controls are named for their command, and commands are selectable text. Verified by the same spec on roles, names, and focus.
- [x] 4.3 Electron E2E through `npm run test:e2e`: open Add connection, see the Docker command naming the build's image, expand More options. Verified by `e2e/electron-connection-manager.spec.ts` passing in pull-request CI.
- [ ] 4.4 Add the section to the manager's Add connection page in the `terminay.com` repository, which does not render this component, naming the untagged image. Verified by that repository's pull request.
- [x] 4.5 Check the section at phone width and in both themes. Verified by the phone-width case in `e2e/remote-control-management.spec.ts` and by rendering it in both themes.

## 5. Remote Control saved servers

- [x] 5.1 Feed the Remote Control saved-server list from the host's remembered profiles on Desktop, without Local, and keep it current through `connections.changed`. Verified by `e2e/remote-control-management.spec.ts` and `scripts/desktop-window-connections.test.mjs`.
- [x] 5.2 Add the `connections.rename` and `connections.forget` host actions as closed, capability-gated actions. Verified by `packages/protocol/test/host.test.mjs`.
- [x] 5.3 Forget in Electron main: detach in every window, remove the credential, then the metadata; refuse Local and a window's primary. Verified by `scripts/desktop-window-connections.test.mjs`.
- [x] 5.4 Redraw the Remote Control pane: one subject, only working actions, in-place rename and forget confirmation, one notice strip, both themes, saved servers reachable at phone width. Verified by `e2e/remote-control-management.spec.ts`.

## 6. Documentation

- [x] 6.1 Update `docs/operations/docker-image-release.md` for beta images, the tag forms, and native builds. Verified by `scripts/ghcr-image.test.mjs`.
- [ ] 6.2 Make sure `https://terminay.com/docs/installation` covers what the section links to it for: the image quick start, browsers and phones, and a `#manual-install` section. It lives in the `terminay.com` repository. Verified by the published page.

## 7. Close out

- [x] 7.1 `openspec validate --all` passes. Verified by its output.
- [x] 7.2 Open the pull request on `origin` and read back every commit status. Verified by each being `success` or `skipped`.
