# Docker image release contract

Terminay publishes its standalone server OCI image to GitHub Container Registry
when the image workflow runs on a `main` push or a semver `v*.*.*` tag:

| Image | Purpose |
| --- | --- |
| `ghcr.io/<owner>/terminay-server` | Standalone, non-root Terminay Server runtime. |

The server image publishes Linux `amd64` and `arm64` manifests with an SBOM and
BuildKit provenance attestation. A pull request builds it for smoke tests but
does not publish it. The hosted PWA is built and released by `terminay.com`.

## Selecting an image

For a released version, prefer the immutable image digest recorded by GHCR or
the release evidence:

```sh
docker pull ghcr.io/<owner>/terminay-server@sha256:<manifest-digest>
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

The GitHub workflow's SBOM and provenance are release metadata, not proof that
the image is signed by a separately distributed trust root. Signature
publication and verification remain a Task 20 operational release follow-up.
