# Docker image release contract

Terminay publishes its standalone server OCI image for every version the
project publishes: each semver `v*.*.*` release tag, and each Nightly and each
Canary build of the default branch
([ADR-0109](../../openspec/adr/0109-three-release-tracks-and-a-canary-that-is-signed-but-not-notarized.md)).
One manifest is pushed under two names, so both resolve to the same manifest
digest:

| Image | Registry |
| --- | --- |
| `markwylde/terminay` | Docker Hub. The name in the documentation and the one to give a person trying Terminay. |
| `ghcr.io/<owner>/terminay-server` | GitHub Container Registry. |

## Tags

Tags carry no `v` prefix.

| Published by | Tags | Moving tag |
| --- | --- | --- |
| Release `vX.Y.Z` | `X.Y.Z`, `X.Y`, `sha-<commit>` | `latest` |
| Nightly `X.Y.Z-main.N.nightly` | `X.Y.Z-main.N.nightly`, `sha-<commit>` | `nightly` |
| Canary `X.Y.Z-main.N.canary` | `X.Y.Z-main.N.canary`, `sha-<commit>` | `canary` |

`latest` only ever names a release, `nightly` only ever names a Nightly, and
`canary` only ever names a Canary. `N` is the number of commits on the default
branch at the built commit, so a later build sorts higher on either track. A
Nightly or Canary image carries exactly the version its Desktop reports, so a
Nightly or Canary Desktop can name the server image that matches it. A Nightly
image's server follows the `main` channel and a Canary image's the `canary`
channel.

### The `beta` tag until 2027-02-09

Nightly and Canary replaced the single Beta track. So that installations which
followed `beta` move on without anyone acting, every Nightly is also tagged
`beta`, and the Nightly prerelease also carries its update metadata under the
old Beta names (`beta-mac.yml`, `beta-linux.yml`, `beta.yml`), through
**2027-02-09**, ninety days after the change landed. The end date is
`LEGACY_BETA_FEED_UNTIL` in `scripts/legacy-beta-feed.mjs`, which both the
prerelease workflow and the image workflow read, so the tag and the metadata
stop on the same day. After it, the Nightly workflow deletes the Beta metadata
from `main-latest` and the `beta` tag no longer moves. The follow-up change
`retire-beta-feed` removes the script, the copies, the tag publication, and the
Desktop setting's mapping of a stored Beta channel to Nightly.

The Trigger Release workflow publishes the image as its last job, by
dispatching the image workflow at the tag it created. It has to: the release
creates its tag with the workflow token, and GitHub starts no workflow for a
push made with that token, so the tag trigger alone fires only for a tag pushed
by hand. A release whose archives or desktop builds fail verification never
reaches that job, so `latest` does not move.

The image is the standalone, non-root Terminay Server: the same self-contained
tree the release archives carry — pinned Node runtime, compiled server, native
`node-pty`, workspace UI, built-in extensions, and the selected WebRTC runtime —
with the `terminay` command on the `PATH`, and passwordless `sudo` for the
terminals' account. How to run it is in
[Running in a container](./standalone-server.md#running-in-a-container).

The Nightly and Canary workflows publish their image the same way: the last job
of the shared Rolling Prerelease workflow dispatches the image workflow on the
default branch with the build's version and the commit it was built from, after
that build's desktop and archive assets were published. The image workflow
refuses a version that is not in the Nightly or Canary grammar, a branch that
is not the default one, and a commit the default branch does not contain,
before it builds anything. It takes the track from the version, and moves only
that track's tag. A prerelease that fails publishes no image.

The image publishes Linux `amd64` and `arm64` manifests with an SBOM and
BuildKit provenance attestation. Each architecture is built on a runner of that
architecture and pushed by digest; a final job joins the two into one manifest
and applies the tags, so no tag is created or moved unless both were built. A
pull request builds the image and pairs Desktop's own pairing code with it, but
does not publish it. The hosted PWA is built and released by `terminay.com`.

Publication to Docker Hub needs the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
release secrets described in
[release credential bootstrap](./release-credential-bootstrap.md). Where they
are absent the workflow publishes to GHCR alone and does not fail.

## Selecting an image

For a released version, prefer the immutable image digest recorded by the
registry or the release evidence:

```sh
docker pull markwylde/terminay@sha256:<manifest-digest>
docker pull ghcr.io/<owner>/terminay-server@sha256:<manifest-digest>
```

Version tags (`X.Y.Z`) and major/minor tags (`X.Y`) are convenience selectors;
they are not a substitute for recording the digest used in an environment.
`sha-<commit>` identifies the source commit. `latest` names the newest tagged
release, which is what makes the bare image name safe to try. The moving
tags `latest`, `nightly` and `canary`
must not be used for a controlled rollout.

Before deployment, inspect the resolved manifest and retain its digest with the
deployment record:

```sh
docker buildx imagetools inspect \
  ghcr.io/<owner>/terminay-server@sha256:<manifest-digest>
```

The same command against `markwylde/terminay` at the same version reports the
same digest.

The GitHub workflow's SBOM and provenance are release metadata, not proof that
the image is signed by a separately distributed trust root. Signature
publication and verification remain a Task 20 operational release follow-up.
