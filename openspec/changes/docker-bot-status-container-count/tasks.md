## 1. Reproduce in tests

- [x] 1.1 Make the fake engine in `packages/server-core/test/fixtures/bot-socket-server.mjs` answer `GET /containers/json` with HTTP 400 for filter keys Docker does not support. Verify: the existing `bot-composition` status assertion fails against the unfixed driver.
- [x] 1.2 Make the fake engine's container listing return each container's `Labels` alongside its `Id`. Verify: a driver-level listing in the composition test can see helper labels.

## 2. Fix container listing

- [x] 2.1 In `SocketDriver` `container ls`, collect `label!=key` and `label!=key=value` filters as server-side exclusions, send positive filters unchanged, and drop returned containers whose `Labels` match any exclusion. Verify: a driver unit test against a fake transport asserts the outgoing `filters` contain no `label!` key and equal the positive filters.
- [x] 2.2 Cover the exclusion semantics in that unit test: key present with empty value versus absent, matching versus different value, a value containing `=`, multiple exclusions, and a container without `Labels`. Verify: the driver unit test passes with the "Key and value exclusions" scenario's expected result.
- [x] 2.3 In `bot-composition`, add a helper container that carries every positive status label (`terminay.server`, `terminay.bot`, `terminay.managed=1`) plus `terminay.helper`, and a managed bot container for a different server. Verify: `status().botContainers` stays 1.

## 3. Validate

- [x] 3.1 Build server-core and its workspace dependencies (`timeout 900 npx turbo run build --filter=@terminay/server-core...`), then run the server-core bot tests with `timeout 900 node --test --test-force-exit --test-timeout=120000`. Verify: build and tests pass.
- [x] 3.2 Under `timeout 120`, run the built engine service's `status()` against this host's real Docker 26 socket with a temporary helper-labelled container present that carries the probe's server, bot and managed labels, then remove it. Verify: `status()` resolves with Docker available and `botContainers` excludes the helper.
- [x] 3.3 Run `openspec validate --all`. Verify: no errors.

Real Podman is not available on the development host. Podman listing is covered by the strict fake engine and the driver unit tests; the outgoing request on Podman is the same as on Docker.
