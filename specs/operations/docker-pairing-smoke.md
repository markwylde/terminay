# Docker-to-client pairing smoke

This is a local diagnostic harness for the supported foreground path:

`Docker Terminay Server -> readiness/handoff -> health lifecycle -> checked-in client parser`.

It uses the normal foreground server command, not the one-shot `--pairing`
command. The container runs with `--network none`, a read-only worktree mount,
and a bounded `/tmp` tmpfs. Its loopback health listener is probed from inside
the container, so the smoke does not publish a port or contact hosted
signaling, TURN, or WebRTC services. The client parser is bundled from
`src/remote/services/pairing.ts` on the host, exercising the actual checked-in
client contract.

## Run

Build the standalone server first:

```sh
npm run build --workspace @terminay/server
npm run smoke:docker-pairing
```

Use `--strict` when the result is a release gate:

```sh
npm run smoke:docker-pairing -- --strict
```

The harness uses the local image
`docker.io/library/node:22.23.1-bookworm-slim` with `--pull=never`. If Docker,
the image, or the server build is unavailable, it reports a named blocker
without attempting a network pull. Pairing URLs and tokens are redacted from
the report.

## Assertions

The smoke requires all of the following:

- the foreground readiness record is `ready`, identifies the requested server
  and version, uses the loopback endpoint policy, and reports the loopback
  health endpoint;
- the public pairing handoff contains `pairingSessionId`, `pairingExpiresAt`,
  `pairingUrl`, a positive expiry duration, and approval-required metadata;
  `pairingToken` is present only in the URL fragment, never as a readiness
  field;
- the pairing URL is HTTPS, origin-bound, path-only, query-free, and has one
  fragment field for each structured bootstrap value, with the session and
  expiry values matching the readiness record and a non-empty one-time token;
- both `/healthz` and `/readyz` return HTTP 200 with the exact safe ready-phase
  body: status, readiness, phase, server identity, and version only;
- the container remains running after readiness, then accepts `SIGTERM` and
  exits with status 0; and
- the bundled client parser accepts the same structured pairing URL.

## Boundary

A passing result proves the Docker foreground handoff, client bootstrap schema,
and orchestration health lifecycle. It does not claim that an authenticated
application protocol listener is present or that a browser has completed a
remote pairing. Hosted signaling, TURN, WebRTC, and application-protocol
connectivity remain separate release evidence.
