## Why

Upgrading a Canary server from the connection menu ended in "Pop Terminay was
not upgraded · still on 6.10.0-main.3420.canary" although the host had moved
to 3428 and recorded success. Two things were wrong:

- On a rolling channel (Canary, Nightly) the release check named the archive's
  asset, `canary` or `main`, as the available and latest version. The
  confirmation read "3420.canary → canary", and nothing the server ran could
  ever equal it.
- A server reported the version in its install record, which the upgrader
  moves to the new release only once the new server is ready. The restarted
  server's first status still named the old release, and the window that
  followed the upgrade read that as "still on" the old version and failed it.

## What Changes

- The release check reads a rolling build's version from the published
  archive's manifest and reports that as `available` and `latest`. When the
  build is the installed one, `latest` names the installed version.
- A server's upgrade status names the version its own process runs
  (`TERMINAY_SERVER_VERSION`), falling back to the install record only when
  the process was not told.

## Capabilities

### Modified Capabilities

- `server-upgrade`: versions in the status are real build versions.

## Impact

- `apps/terminay-cli/src/commands/check.ts`
- `packages/server-core/src/serverUpgrade/service.ts`
