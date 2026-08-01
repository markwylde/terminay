# Docker image release contract

Terminay publishes two independently consumable OCI images to GitHub Container
Registry when the image workflows run on a `main` push or a semver `v*.*.*`
tag:

| Image | Purpose |
| --- | --- |
| `ghcr.io/<owner>/terminay-server` | Standalone, non-root Terminay Server runtime. |
| `ghcr.io/<owner>/terminay-web` | Static Terminay browser client served by nginx. |

The web image workflow also supports an explicit `workflow_dispatch` run. This
is the operator entry point when the reviewed web-host commit is ready to
publish but no unrelated source change should be introduced merely to trigger
the image build. A manual run publishes the immutable `sha-<commit>` selector;
the workflow fails if publication does not return a canonical SHA-256 manifest
digest and writes the exact digest reference plus source revision to its job
summary. That summary is the handoff into the deployment lock below; the
resulting manifest digest must still be recorded and validated before any CDN
origin is changed.

The image workflows publish Linux `amd64` and `arm64` manifests, attach an
SBOM and BuildKit provenance attestation, and label images with the source,
revision, and version. A pull request builds the server image for smoke tests
but must not publish either image.

## Selecting an image

For a released version, prefer the immutable image digest recorded by GHCR or
the release evidence:

```sh
docker pull ghcr.io/<owner>/terminay-server@sha256:<manifest-digest>
docker pull ghcr.io/<owner>/terminay-web@sha256:<manifest-digest>
```

Version tags (`vX.Y.Z`) and major/minor tags (`X.Y`) are convenience selectors;
they are not a substitute for recording the digest used in an environment.
`sha-<commit>` identifies the source commit. `latest` is only emitted from the
repository default branch and must not be used for a controlled rollout.

Before deployment, inspect the resolved manifest and retain its digest with the
deployment record:

```sh
docker buildx imagetools inspect \
  ghcr.io/<owner>/terminay-server@sha256:<manifest-digest>
```

## Controlled deployment lock

Record the selected server and web image together in a JSON lock. This avoids
accidentally deploying a mutable tag, an image from a different owner, or the
server image in the web slot (and vice versa):

```json
{
  "schemaVersion": 1,
  "owner": "<owner>",
  "version": "X.Y.Z",
  "revision": "<40-lowercase-hex-commit>",
  "images": {
    "server": "ghcr.io/<owner>/terminay-server@sha256:<64-lowercase-hex-digest>",
    "web": "ghcr.io/<owner>/terminay-web@sha256:<64-lowercase-hex-digest>"
  }
}
```

Validate the record before applying it to Compose, Kubernetes, or another
deployment system:

```sh
node scripts/release-image-deployment.mjs deployment-images.json
```

The validator accepts only exact `ghcr.io/<owner>/terminay-server` and
`ghcr.io/<owner>/terminay-web` digest references, a full lowercase commit SHA,
and a semantic release version. It rejects tags, registries/owners outside the
record, credential-bearing URLs, malformed digests, and duplicate server/web
digests. Retain both the validated lock and the manifest inspection output with
the deployment record.

The GitHub workflow's SBOM and provenance are release metadata, not proof that
the image is signed by a separately distributed trust root. Signature
publication and verification remain a Task 20 operational release follow-up.
