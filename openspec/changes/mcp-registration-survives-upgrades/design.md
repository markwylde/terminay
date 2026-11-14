## Context

A standalone installation (`terminay install`, system or user scope, and the
container image's data-volume tree) keeps each release in an immutable
`<prefix>/versions/<release>/` and a symbolic link `<prefix>/current` swapped by
rename. The service unit starts the server through that link, but Node resolves
`process.execPath` and `import.meta.url` to the real release directory. The
server builds its MCP server command from those two values, so the registration
it writes names one release. The upgrader keeps two releases; the third upgrade
after an install deletes the registered one.

Desktop builds its command from the Electron executable and the packaged
`mcpEntry.js` with `ELECTRON_RUN_AS_NODE=1`. An in-place update keeps those
paths, so Desktop registrations stay valid.

## Goals / Non-Goals

**Goals:** a standalone registration never goes stale on upgrade or rollback;
a user can recover any changed entry from Terminay; Desktop is byte-for-byte
unchanged in what it registers.

**Non-goals:** rewriting provider configuration at startup or without a user
action; recognising other servers' entries as "ours".

## Decisions

### 1. Name the installation's pointer, decided from the filesystem

`stableInstallPath(path)` (in `apps/terminay-server/src/stableInstallPath.ts`)
takes the real path of the executable or entry. If an ancestor directory is
named `versions`, its parent `<prefix>` holds a `current` that is a symbolic
link, and `realpath(<prefix>/current)` equals `realpath(<prefix>/versions/<release>)`,
it returns `<prefix>/current/<rest>`. Otherwise it returns the path unchanged.
It is computed once at startup.

The check is structural rather than tied to `installLayout()` so it covers the
system, user and container trees alike, and so Desktop and development
checkouts cannot match. A layout that merely contains a directory called
`versions` without a `current` link pointing at that release keeps its absolute
path, which is today's behaviour.

Alternatives rejected:
- *Re-register on every startup.* Overwrites entries without a user action,
  against the installation-safety requirement, and two servers sharing a home
  directory (Desktop plus a standalone server for the same account) would
  rewrite each other's entry on every start.
- *Keep more releases.* Delays the failure; every upgrade still shows changed.
- *A wrapper script in `<prefix>/bin`.* A new installed artifact that the
  installer, container image and uninstaller must all manage, for what a link
  that already exists provides.

During an upgrade the link is swapped before the old server stops. An agent
that starts its MCP adapter inside that window runs the new release's adapter
against the old server's control socket. The control protocol is versioned
(`protocolVersion: '1'`) and the adapter reports a mismatch as an MCP error; the
agent's next start after the restart works. This window already exists for
every other process started through `current`.

### 2. Replace is an explicit, separate operation

`install` keeps refusing a changed entry, so nothing that calls it — including
a future automatic caller — can overwrite a user's edit. A new optional
`replace` runtime method, routed as the `replace` operation through the
extension host and the `mcp-install.replace` server command, writes the server's
entry over whatever `terminay` entry exists. It goes through the same parse
checks and atomic write as install, so an unparsable file is never rewritten.
The modal shows **Replace** only on a changed row.

The operation crosses the extension boundary: it needs the existing
`mcp-registration` permission and nothing more, since it writes the same entry
install writes. Older extensions that lack `replace` fail closed with a bounded
error. An older server that receives `mcp-install.replace` answers with an
unknown-command error, which the modal shows on the row.

## Risks / Trade-offs

- Existing broken entries need one Replace click per client; they are not
  repaired automatically. This is the safety requirement working as intended.
- A user who hand-edited a `terminay` entry and then presses Replace loses that
  edit. The row shows the configuration path and the reason before the click.
