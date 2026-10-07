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

### 2. On Desktop the bundle's version is the client's version

Desktop runs the workspace bundle packaged with it for every connection, and that bundle is built from the same stamped `package.json` as the application, so its build-time `__TERMINAY_VERSION__` is the application's version. The shell passes it to the Connections route as `appVersion` only when the host is Desktop. A browser session's bundle is its server's and passes nothing, which yields the untagged image. No host bridge or protocol change is needed.

**Boundary:** the shared UI is untrusted renderer code (ADR-0005, ADR-0018) and gains no host access for this. The value is display-only: it is interpolated into text the person copies, never executed, and never sent anywhere. It is validated against the version grammar before use, so an unexpected string cannot shape the displayed command.

- *Alternative: a version field in the host context.* Rejected: a protocol and bridge change to carry a value the Desktop bundle already has.

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

`server-image.yml` gains `workflow_dispatch` inputs `version` and `revision`. `main-prerelease.yml` gets a final job that runs after the prerelease assets are published, and only when the desktop beta was built, and dispatches the image workflow on the default branch with the beta version and the commit it was built from. A dispatch names a branch, not a commit, so the commit travels as an input and is what every job checks out.

A first job, `plan`, decides what the run publishes before anything is built: a release tag publishes its own version and refuses inputs; a version must be on the default branch, match the beta grammar, and name a full commit that branch contains; anything else builds and smokes the image and publishes nothing. The channel is derived, `tag` for a release and `main` for a beta, rather than taken as an input. The version is stamped through the Dockerfile's `OCI_VERSION` argument.

Runs are grouped per version, so a later beta never cancels the image an installed earlier beta names.

**Boundary:** dispatch is the event a workflow token may raise (the release fix established this). The dispatching job holds `contents: read` and `actions: write` and nothing else. The image workflow, not the caller, holds the registry credentials.

- *Alternative: build the image inside `main-prerelease.yml`.* Rejected: two places that know how to build and tag the image.
- *Alternative: a workflow_run trigger.* Rejected: it cannot carry the beta version, which is computed from the run number of the prerelease.
- *Alternative: a `channel` input.* Rejected: it is implied by which of the two forms the run is, and an input could contradict it.

### 6. Native per-architecture image builds, joined by manifest

Two jobs build and push by digest, one per architecture on its native runner, and a third creates the multi-architecture manifest and applies the tags. This is the shape the archive build already has. It matters now because the image is built on every push to the default branch, not a few times a month, and an emulated arm64 build compiles the whole UI under QEMU.

- *Alternative: keep one emulated build.* Rejected for betas on cost; accepted today only because releases are rare.

### 7. The release-only contract is replaced, not deleted

"Server image publication is versioned-release-only" becomes "the image workflow publishes only at a release tag or for a dispatched beta version, and never from a pull request". The property it protected — no image from an unreviewed or unversioned build — is kept: a beta image exists only for a commit on the default branch whose prerelease assets published.

### 8. Remote Control's saved servers are the host's remembered profiles

On Desktop the Remote Control window reads the `connections` capability's profile list through `useConnections()`, the list the connection menu already uses, and shows every remembered profile except Local. The route keeps accepting a `ConnectionProfileStore`, which a browser session supplies; where there is none it takes the host's summaries instead. A status is shown only where the source can speak for the server: the Remote Control window is its own document with its own attached set, so its "offline" would mean "not attached in this window" and is not shown.

The Desktop host subscribes to the `connections.changed` event main already publishes, and main publishes it to every window when the remembered set changes, so a server paired, renamed, or forgotten in one window is current in the others.

- *Alternative: build a `ConnectionProfileStore` from the host list.* Rejected: a profile there requires an origin, and the host deliberately keeps origins out of the bundle.

### 9. Rename and forget are host actions in the `connections` capability

`connections.rename` changes the label in the remembered metadata. `connections.forget` detaches the profile in every window, removes this device's credential for its origin, then removes the metadata. The credential goes first: a profile that is still listed can be forgotten again, while a credential with no profile could never be found. Forget refuses Local, and refuses a profile some window runs on as its primary. A credential shared by two profiles of one origin stays until the last is forgotten.

**Boundary:** both are parsed as closed actions (exact keys, an identifier, a bounded single-line label) and authorized under the existing `connections` capability. The renderer names a profile id and never an origin or a credential. Revocation is a server operation and is not offered for a remembered server here.

### 10. One pane, one subject

The main pane shows the selected sidebar item only. A server shows its name and the actions that work; rename and the forget confirmation replace the actions in place rather than appearing elsewhere on the page. Add connection puts the pairing field and its two buttons on one row with progress beneath. Outcome and error lines share one strip above the pane. The Settings chrome hides its navigation at phone width; here the navigation is the saved servers, so it stays above the pane.

## Risks / Trade-offs

- [The command names an image that does not exist: the image job failed, or the client is older than the first image] → the image is published after the other artifacts, so a failure is visible in the release; the screen links to the installation guide, which uses the untagged image. Releases before this change have no image; Desktop builds from before it have no install section either.
- [A beta image on every push costs build minutes and registry storage] → native builds keep it to roughly the archive build's time; old beta tags can be pruned by a later retention job. Not addressed here.
- [The web manager is a different repository] → it has its own Add connection page; the instructions there, and the installation guide's Docker and manual-install sections the screen links to, are a follow-up change in `terminay.com`.
- [`beta` could move backwards if an older beta's image run finishes after a newer one's] → prereleases are serialized and dispatch in order, so the runs would have to overtake each other; versioned tags are unaffected.
- [Forgetting a server attached in another window leaves that window's tabs for it greyed] → they are inert and detachable from its connection menu, as for any lost connection.
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
- After pairing, Desktop remounts the pairing window onto the new server. Whether Remote Control should instead stay open on the new server's entry is not addressed here.
- No in-force ADR needs revisiting. ADR-0032's statement that the GitHub mirror runs publication workflows only still holds: this adds a publication, not a verification lane.
