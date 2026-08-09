# Web connection host deployment

This runbook deploys the static Terminay connection manager to
`https://app.terminay.com`. A healthy CDN endpoint alone is not deployment
proof: the root document, its assets, and the required security headers must
also pass the repository verifier.

## Publish and select the immutable image

The normal production path is the repository **Trigger Release** workflow. It
builds the web image from the exact release tag and source commit, publishes
matching `latest`, semantic-version, minor-version, and commit tags, and blocks
final release-note publication until the image succeeds. The standalone
web-image workflow is manual recovery only:

```sh
gh workflow run web-image.yml --repo markwylde/terminay --ref main
gh run list --repo markwylde/terminay --workflow "Web image" --limit 1
gh run watch <run-id> --repo markwylde/terminay --exit-status
gh run view <run-id> --repo markwylde/terminay
```

Copy the exact `ghcr.io/markwylde/terminay-web@sha256:<digest>` reference and
source revision from the workflow summary. Put that digest in the controlled
deployment lock described by
[Docker image release contract](./docker-image-release.md), then validate it:

```sh
node scripts/release-image-deployment.mjs deployment-images.json
docker buildx imagetools inspect \
  ghcr.io/markwylde/terminay-web@sha256:<digest>
```

Retain the workflow URL, source revision, manifest digest, manifest inspection,
validated lock, SBOM attestation, and provenance attestation as release
evidence. Never deploy a mutable tag such as `latest` or `1.2`.

## Change the web origin

Provision the selected image on an HTTPS-reachable origin with container port
`8080` exposed. Confirm that origin returns the image's `/healthz` response and
the Terminay manager at `/` before changing public traffic. Record the current
origin, Host header, custom-hostname behavior, and immutable image digest before
editing them; this is the rollback target.

In Bunny, update pull zone `5830725` so its origin URL and origin Host header
target this static web origin, not the Terminay signaling/session service.
Keep `app.terminay.com` attached as the custom hostname and purge the pull-zone
cache after the origin change. This operation requires Bunny dashboard access
or an API key and is intentionally not performed by repository CI.

Routing must fail closed. `app.terminay.com` may route only to the selected
static manager image, `web.terminay.com` may route only to the bounded retired
manager redirect, and session/signaling hostnames must remain on their own
service. Do not use the signaling service as an origin fallback for either
manager hostname. The image returns HTTP 421 for every unrecognised Host;
loopback hosts are accepted only so the container health check and local image
verifier can exercise the canonical manager. Direct requests for the other
authority's HTML entry point return 404, while content-hashed assets may be
shared by the two checked-in entry points.

## Verify before ticking Task 18

```sh
TERMINAY_EXPECTED_WEB_REVISION=<40-character-source-revision> \
  node scripts/verify-web-host-deployment.mjs
curl -fsS https://app.terminay.com/healthz
curl -fsSI https://app.terminay.com/
curl -fsS https://app.terminay.com/.well-known/terminay-release.json
```

The verifier fails unless HTTPS serves:

- `200 {"ok":true}` from `/healthz`;
- an `application/json` health response and release marker identifying the
  selected full source revision;
- the `Terminay Connections` manager HTML from `/`;
- at least one live built asset; and
- the required CSP, COOP, permissions, referrer, content-type, and frame
  security headers.

Record the verifier JSON, HTTP headers, DNS answer, and TLS certificate details.
Only then may the public deployment checklist item be checked.

Also record the root document and every referenced hashed asset response after
the purge. A healthy response by itself is not evidence: the verifier rejects
the legacy **Terminay Remote** document, host-routing failures, stale release
revisions, unhashed or missing assets, and unexpected asset media types.

## Roll back safely

Rollback changes delivery pointers; it does not delete browser storage or
server-side device state.

1. Select the exact prior image digest and prior routing values captured before
   deployment. Reinspect the digest and revalidate the deployment lock.
2. Restore the prior origin URL and origin Host header for each affected Bunny
   hostname. Keep manager and session/signaling authority separate.
3. Purge the affected entry documents, then run the verifier with the prior
   image's source revision and capture the same DNS, TLS, headers, marker, root,
   and asset evidence.
4. If the prior canonical manager cannot pass the verifier, route to a static
   maintenance response rather than falling through to signaling or another
   application.

Do not clear the legacy manager's profile record during infrastructure
rollback. Do not delete or rewrite reconnect credentials stored at exact
session origins, and do not revoke server-side devices merely to change CDN
routing. If migration has already been acknowledged, follow its documented
cleanup state; never recreate or fabricate migrated secrets.
