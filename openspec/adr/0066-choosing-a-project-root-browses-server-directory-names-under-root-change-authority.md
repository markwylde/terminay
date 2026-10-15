# ADR-0066: Choosing a project root browses the server's directory names, under the authority to change a root

Status: accepted
Date: 2026-10-16

## Context

Every filesystem query Terminay offers a client today is contained by a project
root: the Explorer catalog, search, watches, Git and Documentation all resolve
paths against a canonical root and fail closed outside it (ADR-0011, ADR-0020).
Choosing a root for a new project cannot work that way, because no root exists
yet. The folder has to come from anywhere the server account can reach.

A native dialog in the client host does not solve this. On Desktop attached to a
remote server, and in every browser and phone client, it shows the wrong
machine's disk. The spec already says a new project's root is "browsed and
validated on the server that will own it". The `new-project-start-chooser`
change adds the first query that is not contained by a project root, and the
limits on that query need to outlive the change.

## Decision

1. **One server-side browser for every host.** A project root is chosen by
   browsing the owning server's filesystem through a server query. No client
   host opens a native folder dialog to choose a project root.
2. **Directory names only.** The query returns the canonical folder path, its
   parent, and the names of its subdirectories, bounded with a truncation
   marker. It never returns file names, file contents, sizes, times, or other
   metadata.
3. **Root-change authority.** The query requires the same device authority as
   changing a project root on that server, and is checked before any filesystem
   access. MCP capability tokens and extensions cannot reach it.
4. **Revalidated per request.** Each request canonicalizes its path afresh, as
   ADR-0020 requires of roots. A path from a listing is never trusted when it is
   later submitted as a root: setting the root validates it again.

## Consequences

- A paired device with root-change authority can enumerate the directory tree
  the server account can read. That device can already open a shell on the
  server, so this exposes nothing new, but it is now a named, auditable query
  and not an incidental one.
- Any later "pick a folder on the server" feature, such as choosing a recording
  or export location, reuses this query and its limits rather than adding a
  second unscoped listing.
- Widening the query, for example to return file names or to serve MCP, needs a
  new ADR that supersedes this one.
