## Context

A project's file services are process-local. The file catalog, content stream,
file session, Documentation catalog and MDX runtime adapters authorize a request
only when the host holds a context for that project id. Git and agent scope are
bound the same way. Each host fills these maps when a project is created or its
root changes, through `workspaceOperations.prepareProjectRootUpdate(...).commit()`.

At startup the composition calls `workspaceStartup.prepare()` before it restores
terminals, and passes the projects whose roots could not be bound to the restore
as `unavailableProjectIds`. Desktop supplies `prepare`
(`ServerTerminalAuthority.rebuildProjectBindings`). The standalone server does
not: after a restart its maps hold only the `default` project it builds from
`--project-root`. Every other restored project is refused with
`FileServiceError('path_escape', 'project is not authorized')`. The dispatcher
maps that to `forbidden`, and the client shows "Explorer access was denied".

## Goals / Non-Goals

**Goals:**
- Every restored project with a valid root has its file, content, catalog,
  Documentation, MDX, Git, agent-scope and folder bindings before any client can
  query it.
- A project with a missing root is reported to the restore as unavailable, as on
  Desktop, and does not fail startup.

**Non-Goals:**
- No change to Desktop's binding, the client, the protocol or persistence.
- No change to how Explorer reports a `forbidden` answer. With this fix the answer
  is correct; a genuine denial still shows the same banner.
- Moving binding into Server Core. Each host keeps owning its process-local maps.

## Decisions

**Supply `workspaceStartup.prepare` in the standalone server and bind through the
existing root-update path.** For each project in `workspace.state.projects` whose
`rootOrigin` is not `none`, `prepare` calls the same
`files.prepareProjectRootUpdate(projectId, root)` the workspace operations use,
then commits it with the same follow-up: `agentScope.setProject` and
`folders.projectBound`. It returns the set of projects whose roots could not be
bound. The commit is shared with `workspaceOperations.prepareProjectRootUpdate` as
one helper, so the startup binding and a live create cannot drift apart.
- *Alternative: bind lazily on the first file request for an unbound project.*
  Rejected. A request handler would then decide authority from workspace state on
  the request path. That spreads the binding across five adapters and makes the
  first request after a restart race the binding.
- *Alternative: bind in `serviceLifecycle.start`.* Rejected. `prepare` is the
  documented hook for exactly this, and only it can tell the restore which projects
  to leave without a terminal.

**A root that cannot be resolved is unavailable; any other binding failure stops
startup.** This mirrors Desktop's `isMissingProjectRootError`, keyed on
`FileServiceError.code === 'path_missing'`. `CanonicalProjectPathResolver` reports
every `realpath` failure of the root as `path_missing`: absent, permission denied,
or I/O error. All of those are therefore unavailable rather than fatal, exactly as
on Desktop. That is the intended policy: a root the server cannot resolve is a
recoverable project condition the user repairs by choosing a root. Only a failure
after the root resolves, such as Git refusing to bind, stops startup, because the
server could not then keep its authorization contract.

**An unavailable project holds no authority.** When a project cannot be bound,
`prepare` releases whatever this process already holds for it
(`files.releaseProject`, `agentScope.removeProject`, `folders.releaseProject`,
`gitService.unbindProject`).
The case that matters is the `default` project. The standalone server pre-binds
`default` from `--project-root` at boot, so a `default` whose persisted root is
missing would otherwise keep authority over an unrelated directory. The client
then sees that project's file operations refused until a `project.root.update`
binds it again, through the same path a live root change uses.

**A restored project with a root is rebound from its persisted root, `default`
included.** The persisted root is what the workspace says the project is.
Rebinding replaces the boot-time context with one built the same way as every
other project's. Making the boot-time `default` binding itself follow workspace
state is not needed here and is left alone.

**Projects without a root are skipped.** A project whose `rootOrigin` is `none`,
including one awaiting its start choice, has nothing to bind. The restore already
leaves it without a terminal (project-start-chooser).

Boundary: this is the server's filesystem/Git → project-root authorization
boundary (ADR-0011, ADR-0020). Binding still canonicalizes the root once at bind
time, and every operation still re-resolves it. Nothing about authority moves to
a client or a host.

## Risks / Trade-offs

- [Startup takes longer with many projects, because each bind realpaths its root
  and binds Git] → The binds run once at start, before readiness, which is what
  Desktop already does. Git binding is bounded by the Git service's own timeouts.
- [A missing root's file operations are still answered as refused, not as a
  missing path] → That is fail-closed and unchanged from today. It is now limited
  to projects whose roots really are unavailable, and repairing the root restores
  access.
- [Retained sessions] → Binding is independent of terminals. A project whose
  session survived through its holder is bound the same way, and the restore's
  existing rule (no extra terminal where a panel exists) is untouched.

## Migration Plan

No data changes. The fix takes effect on the next server start. Rolling back
restores the old behaviour, where restored projects are unauthorized until they
are re-rooted.

## Open Questions

None.
