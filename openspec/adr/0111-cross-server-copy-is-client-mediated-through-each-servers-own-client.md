# ADR-0111: Cross-server copy is client-mediated through each server's own client, from one Settings category that spans connections

Status: accepted, supersedes ADR-0075 in part
Date: 2026-11-13
Supersedes: ADR-0075 (rules 2 and 4, for the Import & Export category only: that category has no list column and does not follow the server selector; every other rule, and both rules for every other category, continue)

## Context

A Desktop window holds an authenticated connection to Local and to every
attached remote (ADR-0047). Each server owns its own macros, workflow
templates, shell profiles, automations, and settings. Users want to see where
these differ across servers and copy them between servers.

The specs forbid server-to-server routing and consistency across servers.
ADR-0075 makes Settings the only management surface. It requires server-scoped
categories to follow the server selector (rule 4) and collection categories to
use a list column (rule 2). A cross-server view cannot follow a single-server
selector. It is also a matrix, not a list with a detail, so both rules have to
give way for this one category.

## Decision

1. **The client copies between servers.** A Desktop renderer reads the source
   through the source connection's client. It writes each item through the
   target connection's client, using the operations that the target's own
   Settings uses. Every write carries the revision that was reviewed. No server
   operation reaches another server.
2. **Copies are one-time and matched by kind and name.** Server-assigned ids
   never identify an item across servers. References between items travel as
   named references and are resolved on the target. Every clash is a user
   decision.
3. **One Settings category spans connections.** Import & Export shows every
   attached connection side by side, one column per server. It has no list
   column and does not follow the selector. Each column is that server's data
   through its own client, and values are never merged across columns.
4. **The Terminay menu may open Settings at a category.** **Import & Export…**
   sits under **Settings…** and opens Settings at that category. It is not a
   separate window or route.
5. **Bundles are portable and contain no ids.** A bundle carries a format
   version, portable content, and named references. It never carries server
   ids, item ids, revisions, or vault secrets. It is validated in full before
   it is shown, and written only through each target's normal operations.
   Copied automations always arrive disabled.

## Consequences

- No new protocol surface and no server change.
- A new kind that should be copyable needs a portable schema, a key, a
  fingerprint, and named references in the shared item model.
- The renderer-to-Electron bridge gains one bounded save action for bundle
  bytes. It never takes a path.
- Cross-server copy is Desktop-only while browser hosts attach one server.
