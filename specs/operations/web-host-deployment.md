# Web connection host deployment

This runbook deploys the static Terminay connection manager to
`https://web.terminay.com`. A healthy CDN endpoint alone is not deployment
proof: the root document, its assets, and the required security headers must
also pass the repository verifier.

## Publish and select the immutable image

After the web-image workflow is merged to the default branch:

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
and validated lock as release evidence.

## Change the web origin

Provision the selected image on an HTTPS-reachable origin with container port
`8080` exposed. Confirm that origin returns the image's `/healthz` response and
the Terminay manager at `/` before changing public traffic.

In Bunny, update pull zone `5830725` so its origin URL and origin Host header
target this static web origin, not the Terminay signaling/session service.
Keep `web.terminay.com` attached as the custom hostname and purge the pull-zone
cache after the origin change. This operation requires Bunny dashboard access
or an API key and is intentionally not performed by repository CI.

## Verify before ticking Task 18

```sh
node scripts/verify-web-host-deployment.mjs
curl -fsS https://web.terminay.com/healthz
curl -fsSI https://web.terminay.com/
```

The verifier fails unless HTTPS serves:

- `200 {"ok":true}` from `/healthz`;
- the `Terminay Connections` manager HTML from `/`;
- at least one live built asset; and
- the required CSP, COOP, permissions, referrer, content-type, and frame
  security headers.

Record the verifier JSON, HTTP headers, DNS answer, and TLS certificate details.
Only then may the public deployment checklist item be checked.
