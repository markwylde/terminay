# Docker image release contract

Terminay publishes its standalone server OCI image when the image workflow runs
on a semver `v*.*.*` tag. One build is pushed under two names, so both resolve
to the same manifest digest:

| Image | Registry |
| --- | --- |
| `markwylde/terminay` | Docker Hub. The name in the documentation and the one to give a person trying Terminay. |
| `ghcr.io/<owner>/terminay-server` | GitHub Container Registry. |

The Trigger Release workflow publishes the image as its last job, by
dispatching the image workflow at the tag it created. It has to: the release
creates its tag with the workflow token, and GitHub starts no workflow for a
push made with that token, so the tag trigger alone fires only for a tag pushed
by hand. A release whose archives or desktop builds fail verification never
reaches that job, so `latest` does not move.

The image is the standalone, non-root Terminay Server: the same self-contained
tree the release archives carry — pinned Node runtime, compiled server, native
`node-pty`, workspace UI, built-in extensions, and the selected WebRTC runtime —
with the `terminay` command on the `PATH`. How to run it is in
[Running in a container](./standalone-server.md#running-in-a-container).

The image publishes Linux `amd64` and `arm64` manifests with an SBOM and
BuildKit provenance attestation. A pull request builds it and pairs Desktop's
own pairing code with it, but does not publish it. Nothing is published from
the default branch. The hosted PWA is built and released by `terminay.com`.

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
release, which is what makes the bare image name safe to try. It
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
