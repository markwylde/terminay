# Engine proxy verification — 2026-11-02

## Local checks

- Serialized server/client bot suite: 206 passed, six optional real-environment tests skipped (212 total).
- Proxy protocol suite: nine passed on host Node 24 and on the image's Node 26. It covers Docker/native Podman creation, conflicting ownership labels, preserved Compose labels, independent identities, unrelated-container control, binary uploads, streamed responses, malformed/oversized/compressed creation bodies, HTTP hijacking, fragmented exec bodies, half-close, cancellation and shutdown.
- Real engine integration: passed against the available macOS Podman machine (rootful Podman 6.1.4). Two proxies concurrently ran separate Compose projects and attributed their containers, networks and volumes. Compose exec, log output, a streamed tar build/progress response, native Podman remote creation and cross-bot stopping all passed. Stopping preserved the original creator. Temporary resources were removed.
- Chromium bot UI checks: 40 passed. Docker-isolated Electron bot E2E: eight passed through `npm run test:e2e -- e2e/bots.spec.ts --workers=1`.
- All 27 workspace typechecks passed. Repository lint passed with existing warnings (61 warnings, 19 informational diagnostics); targeted new proxy lint had no issues. `git diff --check` passed.
- OpenSpec active changes/specs: 103 passed, zero failed. Including archives still reports four previously incomplete archived task checklists; this change adds no archive failure.

## Installed development image

The normal image planner/builder published fingerprint `400419ff845dbef911526dc4a7c0a67af5ff7e8090f2c468704c35531c84df73`. The development app recreated bot `bb73c3b01ad6` through its Environment action. The home volume, Codex sign-in and durable message history were preserved; the real Terminay profile was not changed.

The recreated container uses image `4bdfef00a80ded29385047ef3cc98f021639538e270f068049bd171ba7200e23`. Its proxy script SHA-256 matches the source: `92c57a3114bb8f3f518cdee4c94ee3ab44ca95e24fee69b4e4aa61a399ddcb89`.

As unprivileged user `bot`, without changing settings:

- `DOCKER_HOST` and `CONTAINER_HOST` select `unix:///var/run/docker.sock`; the raw upstream path cannot be read.
- Standard Docker reaches the engine and bundled Docker Compose 2.26.1 starts a service with a named volume and network.
- `docker compose exec -T` returns the expected output and Compose logs return the service's output.
- Container, volume and network inspections retain Compose metadata and show the current server, bot and workload labels.
- Environment → Containers displays exactly the attributed service, with normal actions, and hides internal infrastructure. After Compose down with volume cleanup and Refresh, it displays “No containers.”

Production Node 26 initially exposed a parser difference: an upgrade request's JSON body could already be buffered on IncomingMessage, so forwarding only raw socket bytes left exec waiting for its body. The proxy now forwards that buffered body before remaining upgrade bytes. A deterministic regression case and both Node versions verify it; the installed image's successful Compose exec verifies the shipped path.

## Coverage limits

No separate real Docker daemon or real Linux rootless engine was available in this run. Docker-compatible payload/framing tests and rootless mount/user-namespace fixtures passed, but they do not establish live coverage of those engines. Native Podman clients require a Podman engine. Unknown API endpoints remain transparent; attribution is implemented for container/network/volume creation, not a universal ownership/security boundary. Existing resources are not retroactively relabelled.

## Pull request

Delivered through [Gitea PR #479](https://git.i.wylde.net/markwylde/terminay/pulls/479), whose updated multiline description was read back exactly. All 27 commit statuses for implementation head `0b7eeb23277a6a5f904262494ea2bacae4210bf8` were read back as success in [CI run 22990](https://git.i.wylde.net/markwylde/terminay/actions/runs/22990), covering all 18 E2E shards, workspace tests, WebRTC, MCP CLI compatibility, packaged Linux/macOS and container image startup. This evidence/checklist follow-up changes documentation only; PR readiness still requires the current head's checks to pass.

## Container presentation refinement

The owner's live hello-world workload exposed cramped columns, raw port JSON, a nanosecond timestamp and vertically stacked actions. The view now combines name/image identity, readable port mappings, a status badge, relative age with a full-date tooltip and compact horizontal actions. Narrow panels reflow metadata beneath the identity. Existing bot buttons, badges and dialog styling are reused; removal uses the browser's native modal dialog for focus, keyboard cancellation and placement.

All 42 bot Chromium UI checks passed. Added checks use the reported long identifiers and cover 1920, 1000, 760 and 480 px widths, no row overflow or action wrapping, deduplicated wildcard/IPv6 mappings, UDP, internal/no ports, missing dates, correctly targeted actions and cancellation/confirmation of removal. Screenshots were inspected at desktop and narrow widths, including the removal dialog. Renderer TypeScript, targeted lint and `git diff --check` passed; all 103 active/spec OpenSpec items validated.

The rebuilt development app displayed the actual `hello-world-bb73c3b01ad6-hello-world-1` workload with its complete name, image, `8080 → 8080` mapping, creation age and horizontal actions. The workload remained running with its existing container ID. No container image rebuild or recreation was needed for this renderer change.
