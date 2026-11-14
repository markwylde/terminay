## Why

After a standalone Terminay Server restarts (an upgrade, a crash, a reboot), every
project it restores shows "Operation failed: Explorer access was denied. The
selected server account cannot access project … on server …" as soon as Explorer
reads its folder, typically when the user opens a new terminal. The project and its
terminals are back, but its files are not reachable until the user creates the
project again or changes its root. Projects created after the restart work, which
makes the failure look intermittent.

The cause is on the server. File, content, catalog, Documentation, MDX and folder
services authorize a project only once the host has bound that project's root in
the current process. Desktop rebinds every restored project before the restore
runs, through the composition's `workspaceStartup.prepare` hook. The standalone
server supplies no `prepare`, so after a restart only its `default` project is
bound. Every other restored project is answered with "project is not authorized",
which reaches the client as `forbidden`. With no `prepare` the restore also cannot
tell which projects have a missing root. It tries to seed a replacement terminal in
a project whose folder is gone, and that failure ("The project folder is missing or
inaccessible.") stops the standalone server from starting at all.

## What Changes

- Before it restores the workspace, the standalone server binds every restored
  project that has a root. The binding uses the same path as a project create or
  root update: file, content, catalog, Documentation and MDX services; Git; agent
  scope; folder reconciliation.
- A restored project whose root cannot be resolved is reported as unavailable to
  the restore. Any authority the server bound for it at boot is released. It keeps
  its recoverable error, gets no replacement terminal, regains access once its root
  is repaired, and does not stop the server from starting.
- Projects without a root, including those awaiting a start choice, stay unbound.
- The restore requirement now also states how sessions retained by their holder
  are adopted, so it agrees with the terminal-workspace contract.
- The restore contract now states that a restored project's file, Explorer, Git
  and Documentation access works after a restart exactly as before it, on every
  host.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-owned-workspace-state`: "Restoring a non-empty repository" requires a
  restored project with a valid root to have its server-held file and Git access
  re-established before the workspace is shown, on every host.

## Impact

- `apps/terminay-server/src/cli.ts`: supply `workspaceStartup.prepare`, which binds
  restored projects through the existing `prepareProjectRootUpdate` path.
- `apps/terminay-server/test/`: a new test that starts the standalone server,
  restarts it on the same data root, and reads a restored project's folder.
- No protocol, client, or persistence change. Desktop already behaves this way.
