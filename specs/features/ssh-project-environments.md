# SSH project environments

## Summary

The official SSH extension lets the selected Terminay Server open a complete
project on an existing POSIX SSH host without installing Terminay on that host.
It provides a remote PTY and SFTP-backed project filesystem through the
server-owned [project environment](./project-environments.md) contract. Desktop
and browser clients never make the SSH connection or hold its credentials.

SSH is also the workspace transport used by infrastructure extensions such as
Puzed after they provision or select a VM.

## Extension and profile ownership

`terminay-plugin-ssh` is a separate npm repository/package and an official
catalogue entry. It uses only the public
[server extension platform](./extension-platform.md). The selected Terminay
Server owns its installation, profiles, trusted host keys, vault references,
connection pool, runtime status, and audit records.

An SSH profile contains bounded non-secret configuration:

- stable id and immutable configuration revision;
- display name, hostname, port, and username;
- authentication mode and namespaced secret references;
- strict or explicitly unsafe host-verification policy and trust-record
  metadata;
- optional default project root;
- connect/handshake/keepalive timeouts; and
- safe status and last-success metadata.

Changing host or port requires new trust. Editing a profile creates a new
revision; active projects stay pinned until an explicit validated update.
Removal is blocked while referenced.

## Authentication

The first release supports:

- an imported private key in the Terminay Server vault, with an optional
  passphrase stored as a separate scoped secret;
- the SSH agent available to the selected Terminay Server; and
- a guarded password fallback stored in the vault.

The UI explains that a remote Terminay Server uses its own vault and
`SSH_AUTH_SOCK`, never a keychain, file, or SSH agent on the Desktop/browser
device. A client-local file picker cannot silently configure a remote server.

Keyboard-interactive authentication, SSH certificates/FIDO, ProxyJump/bastion
chains, port forwarding, and agent forwarding are outside the initial release.
They require explicit later capabilities rather than shelling out to an
unbounded user command.

Secret values never appear in profiles, workspace snapshots, renderer state,
URLs, commands, argv, logs, audit, diagnostics, or error text. The SSH extension
receives only the exact profile/purpose secret needed for a connection attempt.

## Host verification

Verification is strict by default.

- First contact pauses with `host-key-approval-required` and a server-observed
  host, port, key algorithm, and SHA-256 fingerprint. **Trust and continue** is
  a revisioned, one-use command bound to the exact connection challenge. It
  stores the exact public host key, not merely its display fingerprint.
- A later different key fails closed as `host-key-mismatch`, shows expected and
  actual fingerprints, and requires a separate deliberate **Replace trusted
  key…** action. A stale/replayed approval cannot change trust.
- Hostname/IP changes may retain trust only when the provider supplies a stable
  logical host identity and the pinned key still matches. Puzed uses a stable
  machine-scoped identity while its DHCP dial address may change.
- The per-profile checkbox **Disable host key verification (unsafe)** is off by
  default, requires explicit permission and confirmation, stays visibly
  warned, and is audited. There is no global bypass and it is never silently
  inherited. Turning it off returns to strict verification.

## Connection and status

Terminay Server opens SSH directly using structured host, port, username, and
auth inputs. It does not construct an interpolated shell command. A pool may
share one transport per exact profile revision while preserving project/root/
session/channel identities and bounded channel counts.

Safe statuses include `disconnected`, `connecting`, `ready`,
`host-key-approval-required`, `host-key-mismatch`,
`authentication-failed`, `unreachable`, `root-unavailable`, `reconnecting`,
and `disabled`. Profile testing presents stages:

```text
Resolving host -> Connecting -> Verifying identity -> Authenticating
-> Discovering home and shell -> Ready
```

The pool uses keepalives, bounded exponential backoff with jitter, deadlines,
and manual Retry. A new terminal/read may wait for one bounded connection
attempt. Ambiguous filesystem mutations are never blindly retried.

Transport loss interrupts every affected live terminal exactly once when SSH
cannot prove the channel/process survived. Reconnection permits new operations
but does not manufacture a replacement shell under the old session id. Project
and panel state remain recoverable. Server restart follows the same interrupted
session contract and reconnects profiles lazily.

## Roots and filesystem

The default project root is the configured profile default when present,
otherwise the remotely discovered account home. `~` expansion occurs only in
the provider; the persisted root is a verified canonical absolute remote path.
Users can change an individual project's root through the standard project
editor/root shortcut, and profile-default changes affect future projects only.

The provider exposes a bounded pre-project remote directory browser and an
SFTP filesystem adapter for canonical realpath/stat/lstat/list/ranged read,
write, create, rename, and remove. SFTP errors normalize into Terminay's
host-neutral missing/not-directory/permission/conflict vocabulary before path
resolution. Raw numeric SFTP statuses never bypass canonicalization.

The existing project containment, symlink, size/depth/count/byte, cancellation,
conflict, and destructive-confirmation rules continue to apply against the
remote filesystem. Writes use a random sibling temporary file plus rename when
the server supports it, with bounded cleanup. Unsupported atomic rename,
cross-device replacement, partial upload, disk full, and disconnect return
explicit outcomes.

SFTP has no portable watch. SSH v1 advertises filesystem observation as
unavailable and supplies manual refresh; it never watches the same path string
on the Terminay Server host. Later bounded provider observation/polling must be
declared and cannot weaken the UI's no-hidden-unbounded-polling rules.

Dirty file sessions remain bound to the exact environment/root/revision. A
disconnect preserves drafts. An outcome-unknown save refreshes canonical
metadata and requires reconciliation rather than automatic replay.

## Remote terminal

SSH v1 supports POSIX targets. It requests a remote PTY and adapts its channel
to Terminay's server-owned terminal service for bytes, resize, exit, kill,
backpressure, attachment, presentation recovery, activity, recording, and
client-disconnect behavior.

The initial catalogue provides **Remote system default**. Terminay validates
and launches a trusted provider-generated shell at the canonical project root;
it does not apply local server shell profiles or accept a renderer-generated
command string. Additional remote shell discovery is future work.

Remote current-cwd, foreground-process, native PID, and journal observation may
be unavailable. Cwd presentation may retain the spawn root, close protection
reports its limited capability, and authoritative agent integration remains
unavailable rather than inspecting the local SSH client process.

Server-local launch environment is filtered at the provider boundary. Provider
homes, credentials, and host-only variables are never copied into the remote
shell. Project/session identity variables are sent only when an explicit remote
consumer capability exists.

## Git, agents, and recording

- Recording operates at Terminay Server's routed terminal-stream boundary and
  works without target-side storage.
- Generic terminal-output activity remains available.
- Authoritative journal/process-tree agent status is unavailable in SSH v1.
- Git is unavailable until the extension provides an argv-safe bounded remote
  runner and POSIX path adapter. It never invokes local Git with a remote root.
Unavailable capabilities have explicit UI states; none silently execute on the
Terminay Server machine.

The complete SSH service-parity phase adds these capabilities through
provider-owned remote mechanisms:

- **Git:** an argv-safe bounded SSH exec runner and POSIX path adapter supports
  repository discovery, status, branches, worktrees, diffs, fetch, and reviewed
  Quick Push. Credentials remain target-side or use an explicit scoped provider
  mechanism; remote paths never enter local Git.
- **Filesystem observation:** a versioned remote watcher/helper, or an explicit
  bounded polling mode where necessary, publishes canonical root-scoped events,
  gap/resync state, and lifecycle. Observation stops when unused and always
  retains manual refresh as a safe fallback.
- **Cwd and foreground process:** a versioned target helper binds observations
  to the exact remote terminal session/channel. Stale or unprovable data is
  labelled unavailable and cannot drive close protection.
- **Agents:** the target helper supplies process-to-journal writer proof and
  bounded provider-journal events for the exact session. Raw journal content
  remains server-private; terminal activity remains the fallback when proof or
  a supported driver is unavailable.
- **Remote MCP:** a target bridge uses short-lived, mutually authenticated,
  replay-resistant project/environment/session capabilities to reach the
  existing server-authorized MCP surface. The server-local socket/token is
  never exposed to the network or copied into a remote environment.

Helper absence, incompatibility, crash, target restart, or bridge revocation
degrades only the affected optional capability. Terminal/filesystem sessions
remain represented, and no feature substitutes This server state.

## Setup experience

**Add SSH server…** keeps the Project Environments navigation and selected
Terminay Server context visible while the right-hand detail pane becomes the
declarative connection form. The user can cancel or save back to the same
environment list without opening an unrelated full-window form:

1. display name;
2. hostname, port (default 22), and username;
3. SSH agent, vault private key, or password authentication;
4. strict host verification and the separately confirmed unsafe bypass;
5. default project root (`~` by default); and
6. Test and Save.

Failures preserve safe fields, focus an error summary, point to the relevant
field, and never echo credentials/key content. Selecting a saved SSH profile
from the project split button performs bounded connection/root validation,
then atomically creates and activates the project.

## Acceptance outcomes

- Desktop and browser use one server-owned SSH project without either opening
  SSH or receiving credentials.
- A remote Terminay Server connects from its own network/vault/agent context,
  and diagnostics say which server made the attempt.
- First-use trust, key mismatch, replacement, and per-profile unsafe bypass are
  distinct revisioned/audited flows.
- A remote PTY starts at the canonical environment root and supports input,
  resize, exit, recording, reconnect state, and exact session authorization.
- SFTP listing/view/edit/root changes preserve containment and never touch the
  Terminay Server filesystem with the same path.
- Transport loss interrupts old terminals without creating replacements and
  preserves project state and file drafts.
- Missing Git, watch, process, agent, and MCP capabilities render unavailable
  and never fall back to local services.
- In the service-parity phase, remote Git, observation, authoritative agents,
  and MCP prove exact project/environment/session scope under helper loss,
  replay, reconnect, upgrade, and cross-project attack fixtures.
