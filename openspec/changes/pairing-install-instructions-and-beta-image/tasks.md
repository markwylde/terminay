## 1. Image workflow

- [ ] 1.1 Add `version` and `channel` inputs to `server-image.yml`'s `workflow_dispatch`, validated against the beta version grammar when the ref is not a release tag. Verified by a contract test in `scripts/ghcr-image.test.mjs` and by a dispatch with a malformed version failing before any build.
- [ ] 1.2 Tag rules: a release tag publishes `X.Y.Z`, `X.Y`, `latest`; a dispatched beta version publishes that version and `beta`; no `v` prefix; `latest` never from a beta and `beta` never from a release. Verified by the contract test asserting each rule's condition.
- [ ] 1.3 Build `amd64` and `arm64` on native runners, push by digest, and join them in a manifest job that applies the tags only when both succeeded. Verified by the contract test (no QEMU step, two native runners, one manifest job that needs both) and by `docker buildx imagetools inspect` on the first published beta listing both platforms.
- [ ] 1.4 Stamp the dispatched version through `OCI_VERSION` and `TERMINAY_CHANNEL`. Verified by running the first published beta image and reading `terminay daemon status`.

## 2. Prerelease publishes a beta image

- [ ] 2.1 Add a final job to `main-prerelease.yml` that dispatches `server-image.yml` at the built commit with the beta version, after the prerelease assets are published, holding `contents: read` and `actions: write` only. Verified by a contract test and by the first push to the default branch producing an image run.
- [ ] 2.2 Replace "server image publication is versioned-release-only" in `scripts/provider-portable-ci.test.mjs` with the rule in design decision 7, and update `scripts/task20-ci-security.test.mjs` for the new job and its permissions. Verified by `npm run test:ci`.
- [ ] 2.3 Confirm on the first beta that `markwylde/terminay:<beta version>` and the GHCR tag share one digest, `beta` points at it, and `latest` did not move. Verified by recording the three `imagetools inspect` results in the pull request.

## 3. Install commands

- [ ] 3.1 Add `serverInstallCommands({ version })`, a pure function returning the image reference and every command, deriving stable, beta, or unknown from the version grammar. Verified by unit tests for `5.13.0`, `5.13.0-beta.214`, `0.0.0`, an absent version, and a malformed one.
- [ ] 3.2 Pass Desktop's application version to the Remote Control window through the preload surface as validated plain data, and accept it as an optional prop on `SharedConnectionsRouteBody`. Verified by a test that the renderer receives no other host information and by the Electron E2E in 4.3.

## 4. Add connection section

- [ ] 4.1 Render the section beneath the pairing field: the Docker and Linux host choice, two numbered copyable commands, the sentence pointing at the field above, the collapsed More options disclosure, and the link to the installation guide. Verified by component tests for each scenario of "Add connection shows how to start a server".
- [ ] 4.2 Keyboard and assistive-technology behaviour: the choice, copy controls, and disclosure are operable by keyboard with visible focus, and commands are exposed as text. Verified by component tests on roles, names, and focus order.
- [ ] 4.3 Electron E2E through `npm run test:e2e`: open Add connection, see the Docker command naming the build's image, copy it, expand More options, then pair with a pasted URL as before. Verified by the suite passing in pull-request CI.
- [ ] 4.4 Establish whether `app.terminay.com` renders this component. If it does, verify the untagged image is shown there; if not, open the follow-up in the `terminay.com` repository and note it in the pull request. Verified by the note.
- [ ] 4.5 Check the section at phone width and in both themes. Verified by screenshots in the pull request.

## 5. Documentation

- [ ] 5.1 Update `docs/operations/docker-image-release.md` for beta images, the tag forms, and native builds. Verified by `scripts/ghcr-image.test.mjs`.
- [ ] 5.2 Make sure `https://terminay.com/docs/installation` covers what the section links to it for: the image quick start, browsers and phones, and the manual install. It lives in the `terminay.com` repository. Verified by the published page.

## 6. Close out

- [ ] 6.1 `openspec validate --all` passes. Verified by its output.
- [ ] 6.2 Open the pull request on `origin` and read back every commit status. Verified by each being `success` or `skipped`.
