## Context

Add connection (`src/shared/SharedConnectionsRouteBody.tsx`) is one field and two buttons. It is shared by Terminay Desktop's Remote Control window and the web renderer in this repository. The manager at `app.terminay.com` is built and released from the `terminay.com` repository.

The official image (`markwylde/terminay`) is published by `.github/workflows/server-image.yml`, on release tags only. A contract test, "server image publication is versioned-release-only" in `scripts/provider-portable-ci.test.mjs`, enforces that. The rolling prerelease (`.github/workflows/main-prerelease.yml`) runs on every push to the default branch, computes `<next stable>-beta.<run>` with `scripts/main-beta-version.mjs`, stamps it with `scripts/sync-package-version.mjs`, and builds the server archive for each architecture on a native runner (`ubuntu-latest`, `ubuntu-24.04-arm`). The image is instead built once under emulation for both architectures.

The owner's decisions are in `questionnaires/scope.yaml`.

In-force ADRs that bear on this: ADR-0005 and ADR-0018 (the renderer is untrusted and gets no ambient host access; hosts are protocol-blind), ADR-0016 (release channels: tag and rolling `main`), ADR-0027 (Desktop's beta channel and its version grammar), ADR-0032 (pull-request CI on Gitea; the GitHub mirror runs publication workflows only), ADR-0033 (pinned Node and npm), ADR-0034 (no media relay; the image's networking model).

## Goals / Non-Goals

**Goals:**

- A person on Add connection can start a server and pair with it without leaving the screen, by copying two commands.
- The Docker command names an image that exists and matches the client: a beta client gets a beta server.
- The screen stays simple: two options visible, the rest behind one disclosure, detail on the website.

**Non-Goals:**

- Explaining networking, exposure, firewalls, or troubleshooting in the app. The website does that.
- A native macOS server. On a Mac the option is Docker.
- Running or detecting Docker from the app, or starting a server on the person's behalf.
- Detecting the person's LAN address to fill in the browser-and-phone command. It shows a placeholder.
- Changing the systemd installer or publishing a beta CLI to npm.

## Decisions

### 1. The commands come from one pure function of version and channel

`serverInstallCommands({ version, channel })` returns the commands as data: the image reference, the Docker run line, the pairing line, the Linux installer line, and the advanced ones. The component renders them; tests assert on the function. The channel is derived from the version by the project's existing grammar: `X.Y.Z` is stable, `X.Y.Z-beta.N` is beta, and anything else — including the development placeholder `0.0.0` — is "unknown" and yields the untagged image.

- *Alternative: have the server or a hosted endpoint say which image to use.* Rejected: there is no server yet at this point, and the app's own version is the fact that matters.

### 2. The host supplies its version; the renderer does not discover it

**Boundary:** the shared UI is untrusted renderer code with no Node or ambient IPC access (ADR-0005, ADR-0018). Desktop passes its application version to the Remote Control window through the existing preload surface as plain data, and `SharedConnectionsRouteBody` takes it as an optional prop. The web renderer passes nothing, which yields the untagged image. The value is display-only: it is interpolated into text the person copies, never executed, and never sent anywhere. It is validated against the version grammar before use so that an unexpected string cannot shape the displayed command.

### 3. The screen: two options, one disclosure, one link

Below the pairing field, under the heading "Don't have a server yet?":

- A two-way choice, **Docker** (selected) and **Linux host**. "Docker" is labelled as working on macOS, Windows, and Linux, which is the Mac answer.
- For the selected option, two numbered steps, each a single command with a copy control: start the server, then print the pairing link. One sentence says to paste that link in the field above.
- A collapsed **More options** disclosure: the browsers-and-phones Docker command with `<this machine's address>` as a visible placeholder; Docker with host networking on Linux; a link to the manual archive install.
- A link to `https://terminay.com/docs/installation`.

Commands are in a monospace block, wrap rather than scroll at narrow widths, and are selectable text. The copy control uses the clipboard path the app already uses for copy actions.

- *Alternative: tabs for every option.* Rejected by the owner's steer: it should read as a simple, standard onboarding, not a matrix.
- *Alternative: a separate "Install a server" page.* Rejected: the person is already on the screen where the result is needed.

### 4. Linux host command by channel

Stable shows `sudo npx terminay daemon install`, which takes the newest release. Beta shows `sudo npx terminay daemon install main`, the rolling default-branch channel, because the CLI is published to npm for stable releases only and `main` is the installer's name for what a beta is built from. The pairing step is `sudo npx terminay daemon qr-code` for both.

### 5. The prerelease dispatches the image workflow with its beta version

`server-image.yml` gains `workflow_dispatch` inputs: `version` and `channel`. `main-prerelease.yml` gets a final job that runs after the prerelease assets are published and dispatches the image workflow at the built commit with the beta version and `channel=main`. The image workflow validates the version against the beta grammar when dispatched on a branch, stamps it through the Dockerfile's existing `OCI_VERSION` argument, and tags the result with that version and `beta`. A release continues to dispatch at its tag, with no version input, and publishes `X.Y.Z`, `X.Y`, and `latest`.

**Boundary:** dispatch is the event a workflow token may raise (the release fix established this). The dispatching job holds `contents: read` and `actions: write` and nothing else. The image workflow, not the caller, holds the registry credentials.

- *Alternative: build the image inside `main-prerelease.yml`.* Rejected: two places that know how to build and tag the image.
- *Alternative: a workflow_run trigger.* Rejected: it cannot carry the beta version, which is computed from the run number of the prerelease.

### 6. Native per-architecture image builds, joined by manifest

Two jobs build and push by digest, one per architecture on its native runner, and a third creates the multi-architecture manifest and applies the tags. This is the shape the archive build already has. It matters now because the image is built on every push to the default branch, not a few times a month, and an emulated arm64 build compiles the whole UI under QEMU.

- *Alternative: keep one emulated build.* Rejected for betas on cost; accepted today only because releases are rare.

### 7. The release-only contract is replaced, not deleted

"Server image publication is versioned-release-only" becomes "the image workflow publishes only at a release tag or for a dispatched beta version, and never from a pull request". The property it protected — no image from an unreviewed or unversioned build — is kept: a beta image exists only for a commit on the default branch whose prerelease assets published.

## Risks / Trade-offs

- [The command names an image that does not exist: the image job failed, or the client is older than the first image] → the image is published after the other artifacts, so a failure is visible in the release; the screen links to the installation guide, which uses the untagged image. Releases before this change have no image; Desktop builds from before it have no install section either.
- [A beta image on every push costs build minutes and registry storage] → native builds keep it to roughly the archive build's time; old beta tags can be pruned by a later retention job. Not addressed here.
- [The web manager is a different repository] → task 4.4 establishes whether it renders this component; if not, the instructions there are a follow-up change in `terminay.com`.
- [Copy shows a command the person runs with their own privileges] → the text is assembled from constants and a validated version; nothing from a server, a URL, or user input reaches it.
- [Beta Linux hosts install `main`, which may be a newer commit than the beta client] → the protocol negotiates compatibility per connection (ADR-0018); the alternative is no Linux option for beta clients.

## Migration Plan

1. Land the release fix that adds the image workflow's dispatch trigger.
2. Land the image workflow changes and the prerelease dispatch. The next push to the default branch publishes the first beta image; confirm its digest under both names and that `latest` did not move.
3. Land the Add connection section. From that beta onward, beta Desktop names an image that exists.
4. The next stable release publishes `X.Y.Z` and `latest`.

Rollback: revert the prerelease dispatch job to stop beta images; revert the UI section independently. Published tags are left in place.

## Open Questions

- Should old beta image tags be pruned, and after how long?
- Does `app.terminay.com` render this shared component, or its own Add connection page?
- No in-force ADR needs revisiting. ADR-0032's statement that the GitHub mirror runs publication workflows only still holds: this adds a publication, not a verification lane.
