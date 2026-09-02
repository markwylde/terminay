# Docker pairing smoke evidence

Date: 2026-07-27. This is local, platform-specific evidence from the current
worktree. It does not claim external deployment, hosted signaling, TURN,
Electron, signing, or a production browser pairing.

The foreground Docker smoke passed with:

- Docker client/server 5.8.4;
- local image `docker.io/library/node:22.23.1-bookworm-slim`;
- a detached container running the normal server CLI with `--network none`, a
  read-only worktree mount, and a bounded `/tmp` tmpfs;
- readiness containing the requested identity/version, loopback policy,
  loopback health endpoint, and the structured pairing session/expiry fields;
- a pairing URL whose HTTPS origin, query-free path, and three structured
  fragment fields were validated, while the public readiness record continued
  to omit the token outside that fragment;
- exact HTTP 200 `/healthz` and `/readyz` ready-phase responses containing only
  safe lifecycle metadata; and
- a live foreground process after readiness that stopped on `SIGTERM` with
  exit status 0.

The checked-in client parser accepted that same pairing URL. The report exposes
only the pairing fragment and token lengths, never the token value.

Focused deterministic validation:

```sh
node --test scripts/docker-pairing-smoke.test.mjs
```

Result: 4/4 tests passed. The strict Docker command also passed; the local
report recorded Docker, handoff, health, lifecycle, and client statuses as
`passed` with no blockers.

The smoke was run against the already-built
`apps/terminay-server/dist/cli.js` artifact. The documented server build is a
prerequisite for a fresh checkout; no application source, Dockerfile, or
generated server artifact was changed in this slice. The smoke remains
diagnostic evidence for the foreground handoff/bootstrap/health boundary, not
evidence of authenticated application transport or hosted WebRTC connectivity.

The runnable procedure is documented in
[`docker-pairing-smoke.md`](../../../docs/operations/docker-pairing-smoke.md).
