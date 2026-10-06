## Why

A person who opens **Add connection** sees one empty field asking for a pairing URL, and nothing that says where a pairing URL comes from. They have to leave the app to learn that they need a Terminay server and how to start one. The official image makes that a two-line answer, but only for stable releases: a beta build of Desktop has no image that matches it, because images are published for tagged releases only.

Remote Control itself does not show the servers a person has added. On Desktop its list is always empty: it reads a store that holds at most the window's own connection, while the header connection menu reads the host's remembered profiles. A server paired last month appears under **Attach** in the menu and nowhere in the window meant to manage it, so it can be neither renamed nor forgotten.

## What Changes

- **Remote Control lists the servers the host remembers.** On Desktop the saved-server list is the same remembered set the connection menu offers to attach, kept current as servers are paired or forgotten in any window. Local is this computer and is not listed as a saved server.
- **A remembered server can be renamed and forgotten on Desktop.** Two host actions, `connections.rename` and `connections.forget`, join the `connections` capability. Forget removes this device's credential and metadata for the server and revokes nothing on it.
- **The Remote Control pane is redrawn.** The main pane shows one thing: the selected server with only the actions that work for it, or Add connection with the pairing field and its buttons on one row. Outcome and error lines sit in one place above it. It is legible in both themes, and at phone width the saved servers stay reachable instead of disappearing with the Settings navigation.
- **Add connection shows how to get a server.** Below the pairing field, a short "Don't have a server yet?" section gives one copyable command for Docker and one for a Linux host, followed by the command that prints the pairing link. A single "More options" disclosure holds the less common cases: browsers and phones, Docker with host networking on Linux, and a link to the manual install. It links to the installation guide on terminay.com for everything else. It appears wherever this repository's Add connection is shown, which is Terminay Desktop; the manager at `app.terminay.com` has its own Add connection page in the `terminay.com` repository and gains the section there.
- **The command matches the app.** Desktop names the image built from its own version: `markwylde/terminay:5.13.0` on a stable build, `markwylde/terminay:5.13.0-beta.214` on a beta. A development build and the web manager name `markwylde/terminay`, which resolves to the newest stable release.
- **A beta image on every push to main.** The rolling prerelease publishes the image tagged with the beta version it already computes, `<next stable>-beta.<run>`, and moves a `beta` tag to it. **BREAKING** for the CI contract that image publication is release-only: that rule is replaced by "an image is published for every version the project publishes".
- **Tags carry no `v` prefix**, as now: `5.13.0`, `5.13`, `latest`, `5.13.0-beta.214`, `beta`.
- **Each architecture is built on its own runner** and the two are joined into one manifest, as the archives already are, so a beta image does not take an emulated arm64 build on every push.

Decisions taken with the owner are recorded in `questionnaires/scope.yaml`: no `v` prefix; the beta tag is the app's beta version; `latest` and `beta` both move; a Mac is served by Docker only; the screen offers Docker, Linux systemd, and an expandable set of further options; both Desktop and the web manager show it.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `connections-and-client-hosts`: the Add connection surface gains server install instructions whose commands name the image matching the client's version and channel; Remote Control lists the host's remembered servers on Desktop, where they can be renamed and forgotten; the saved servers stay reachable at phone width.
- `container-image`: an image is published for each beta build of the default branch as well as each release; the tag forms and the `beta` moving tag are defined; architectures are built natively. This capability is introduced by the unarchived `official-container-image` change, whose `Publication` requirement is amended in place.

## Impact

- `src/shared/SharedConnectionsRouteBody.tsx`, `src/shared/RemoteControlWindow.tsx`, and their styles; `src/shared/ServerInstallGuide.tsx`; `src/shared/serverInstallCommands.ts`, a pure module that turns a version into the commands.
- `packages/protocol/src/host.ts` (two host actions), `electron/main.ts` and `electron/forgetRememberedConnection.ts` (rename, forget, and telling every window when the remembered set changes), `src/shared/connections/` (the Desktop host subscribes to that change).
- `.github/workflows/server-image.yml` (dispatch inputs for a version, per-architecture jobs, manifest merge) and `.github/workflows/main-prerelease.yml` (dispatch after the prerelease assets are published). Depends on the dispatch trigger added by the "publish the server image from the release workflow" fix.
- Contract tests: `scripts/ghcr-image.test.mjs`, `scripts/provider-portable-ci.test.mjs` ("server image publication is versioned-release-only" is replaced), `scripts/task20-ci-security.test.mjs`.
- `docs/operations/docker-image-release.md`; the installation page on terminay.com, which the screen links to.
- The web manager at `app.terminay.com` is built and released from the `terminay.com` repository and has its own Add connection page, so showing the instructions there is a change in that repository.
- No change to pairing, approval, or any server behaviour. Forget deletes a device credential that was previously never deleted.
