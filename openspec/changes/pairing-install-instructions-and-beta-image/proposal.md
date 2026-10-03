## Why

A person who opens **Add connection** sees one empty field asking for a pairing URL, and nothing that says where a pairing URL comes from. They have to leave the app to learn that they need a Terminay server and how to start one. The official image makes that a two-line answer, but only for stable releases: a beta build of Desktop has no image that matches it, because images are published for tagged releases only.

## What Changes

- **Add connection shows how to get a server.** Below the pairing field, a short "Don't have a server yet?" section gives one copyable command for Docker and one for a Linux host, followed by the command that prints the pairing link. A single "More options" disclosure holds the less common cases: browsers and phones, Docker with host networking on Linux, and a link to the manual install. It links to the installation guide on terminay.com for everything else. It appears in Terminay Desktop and in the web manager.
- **The command matches the app.** Desktop names the image built from its own version: `markwylde/terminay:5.13.0` on a stable build, `markwylde/terminay:5.13.0-beta.214` on a beta. A development build and the web manager name `markwylde/terminay`, which resolves to the newest stable release.
- **A beta image on every push to main.** The rolling prerelease publishes the image tagged with the beta version it already computes, `<next stable>-beta.<run>`, and moves a `beta` tag to it. **BREAKING** for the CI contract that image publication is release-only: that rule is replaced by "an image is published for every version the project publishes".
- **Tags carry no `v` prefix**, as now: `5.13.0`, `5.13`, `latest`, `5.13.0-beta.214`, `beta`.
- **Each architecture is built on its own runner** and the two are joined into one manifest, as the archives already are, so a beta image does not take an emulated arm64 build on every push.

Decisions taken with the owner are recorded in `questionnaires/scope.yaml`: no `v` prefix; the beta tag is the app's beta version; `latest` and `beta` both move; a Mac is served by Docker only; the screen offers Docker, Linux systemd, and an expandable set of further options; both Desktop and the web manager show it.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `connections-and-client-hosts`: the Add connection surface gains server install instructions whose commands name the image matching the client's version and channel.
- `container-image`: an image is published for each beta build of the default branch as well as each release; the tag forms and the `beta` moving tag are defined; architectures are built natively. This capability is introduced by the unarchived `official-container-image` change, whose `Publication` requirement is amended in place.

## Impact

- `src/shared/SharedConnectionsRouteBody.tsx` and its styles; a small pure module that turns a version and channel into the commands; the Desktop host supplying its version to the shared UI.
- `.github/workflows/server-image.yml` (dispatch inputs for a version, per-architecture jobs, manifest merge) and `.github/workflows/main-prerelease.yml` (dispatch after the prerelease assets are published). Depends on the dispatch trigger added by the "publish the server image from the release workflow" fix.
- Contract tests: `scripts/ghcr-image.test.mjs`, `scripts/provider-portable-ci.test.mjs` ("server image publication is versioned-release-only" is replaced), `scripts/task20-ci-security.test.mjs`.
- `docs/operations/docker-image-release.md`; the installation page on terminay.com, which the screen links to.
- The web manager at `app.terminay.com` is built and released from the `terminay.com` repository. If its Add connection page does not render this shared component, showing the instructions there is a change in that repository.
- No change to pairing, approval, credentials, or any server behaviour.
