## Context

`BotEngineService.status()` counts bot containers through the socket driver's CLI-shaped `container ls` call with `--filter label!=terminay.helper`. `SocketDriver` turns each `--filter key=value` into a `filters` entry on `GET /containers/json`, so the key becomes `label!`. Podman's compatibility API accepts `label!`; Docker answers `400 invalid filter 'label!'`. `httpError` maps the 400 to `not-running`, `status()` rejects, and the dashboard shows the curated "not running" message with no engine, even though the engine check just succeeded and saved the pin.

Helper containers (file and socket-stat helpers) carry a `terminay.helper` label. They are short-lived and must not inflate the bot-container count.

## Goals / Non-Goals

**Goals:**
- The status read succeeds on Docker and Podman.
- Helper containers stay excluded from the count on both engines.
- Tests fail if a Docker-unsupported filter key reaches the engine.

**Non-Goals:**
- Changing how engine HTTP errors map to user-facing reasons.
- Making container-count failures non-fatal to the status read.
- Changing the protocol, client or dashboard.

## Decisions

**Apply label negation in `SocketDriver`, not at the call site.** `container ls` parses `--filter label!=…` into a local exclusion list, sends only the positive filters, and drops returned containers whose `Labels` match an exclusion. `GET /containers/json` already returns `Labels` on both engines. Callers keep their CLI-shaped arguments, and any future negation filter works on Docker automatically.
- Alternative: remove the filter in `engineService` and list helpers separately to subtract them. Rejected: it takes two requests, and the count is wrong if a helper starts or stops between them.
- Alternative: pass `label!` only when the engine is Podman. Rejected: ADR-0092 commits to one transport with engine-specific handling for discovery and metadata only, not for operations.

**Match Podman's semantics.** `label!=key` excludes any container with that key, including an empty value; `label!=key=value` excludes only that exact value, splitting on the first `=`. Several exclusions combine as "omit if any matches". A container returned without `Labels` matches none. The exclusion runs only after the engine has applied the positive filters, so the server never widens what the engine was asked for.

**Make the fake engine strict.** The test socket server answers unknown filter keys with 400, as Docker does, using Docker's documented `GET /containers/json` filter keys. The existing status assertion then covers this bug.

Boundary: everything stays inside the privileged server's engine transport (ADR-0092). Nothing new reaches clients or bots.

## Risks / Trade-offs

- [The server receives helper containers it then discards] → Helpers are few and short-lived, and the listing was already server-scoped by label.
- [No real Podman on the development host] → The outgoing request is identical on both engines; the strict fake and driver unit tests cover the local exclusion.
- [The fake's allow-list drifts from Docker] → It mirrors Docker's documented filter keys. A key the product starts using must be added to it deliberately.

## Migration Plan

None. The fix takes effect on server upgrade. The saved engine pin and existing containers are unchanged.

## Open Questions

None.
