# Task 20 local Docker server evidence

Date: 2026-07-27

The local container slice is deliberately limited to the standalone server
foreground lifecycle and an orchestration-only health contract. It includes:

- a multi-stage Node 22.23.1 Debian image that builds `@terminay/server`;
- a non-root UID/GID 10001 runtime with `/var/lib/terminay` as the only
  declared persistent volume;
- a shell entrypoint that validates an absolute, writable data root and uses
  `exec` so SIGTERM reaches the foreground Node process;
- Compose defaults for a read-only root filesystem, dropped capabilities,
  `no-new-privileges`, and a bounded `/tmp` tmpfs; and
- `/healthz` and `/readyz` responses that expose lifecycle metadata only.

Focused validation:

```sh
npm run build --workspace @terminay/server
node --test apps/terminay-server/test/health-server.test.mjs apps/terminay-server/test/docker-contract.test.mjs
sh -n apps/terminay-server/entrypoint.sh
git diff --check
```

The focused tests cover readiness/liveness status codes, HEAD/method/path
handling, omission of diagnostics and credentials, CLI health option bounds,
and the Docker/Compose security contract.

Additional local compose validation:

```sh
npm run build --workspace @terminay/client-core
node --test scripts/docker-compose-web-server-smoke.test.mjs
node scripts/docker-compose-web-server-smoke.mjs --strict
```

The compose smoke now records a real local build/run proof for the root
`docker-compose.yaml`: the server runs as the non-root image user with a
read-only root filesystem, no new privileges, all Linux capabilities dropped,
and a bounded `/tmp` tmpfs; the web container proxies the authenticated local
HTTP protocol through nginx; `/healthz`/`/readyz` report lifecycle metadata;
and a server-only restart reconnects through the existing web container. The
redacted run output is recorded in
[`docker-compose-web-server-smoke.md`](./docker-compose-web-server-smoke.md).

Limitations: this is local Docker Compose lifecycle/protocol evidence. It does
not claim signed publication, native release runner execution, TURN/WebRTC
operation, public `web.terminay.com` deployment, or full shared UI parity.
