# Terminay SSH extension

The official server-side SSH provider for Terminay. It opens direct SSH PTY
channels and uses SFTP for bounded project files. Desktop and browser clients
never receive credentials or SSH transports.

Host verification is strict by default. First contact must be approved using
the exact one-use challenge, while key changes require a separate replacement
action. A profile-local unsafe bypass exists for exceptional cases and is
always surfaced and audited.

Passwords and private keys are supplied only inside the public transient secret
callback and are cleared after the connection attempt. SSH-agent mode uses the
public, profile-scoped identity/signing broker; it never receives an agent socket
path and cannot forward the agent to the remote host.

The published package contains precompiled ESM. It has no native dependency and
does not execute install-time compilation.

## Public provider dependency

The `com.terminay.ssh/connection` provider exposes a small, manifest-declared
managed-binding contract for extensions such as Puzed. Terminay authorizes each
call from the caller's declared extension dependency; consumers do not import
this package or server internals.

The operations are `managed-binding.generate`, `bind`, `update`, `verify`,
`approve-trust`, `service`, and `remove`. SSH owns connection state, host trust,
terminal/filesystem transport, and the private key for the complete binding
lifetime. A consumer receives only the dedicated public key and an opaque
binding id. Private key bytes and host-vault references are never dependency
results.

Mutations use the host-propagated idempotency key and expected revision.
Service calls remain bound to that exact binding and revision, so an address
update cannot silently retarget an already-running terminal.

## Optional remote agent helper

Authoritative Codex status requires `terminay-target-helper` on the target. The
extension invokes the fixed `agent-journal-v1` operation over the same pooled
SSH connection as the PTY and supplies a random proof placed only in that
terminal's environment. A compatible helper must prove that the rollout file
has a live writable descriptor owned by a descendant of the exact proof-bearing
terminal process. Cwd, window title, process name, and newest-file matching are
not acceptable evidence.

Requests and replies are newline-delimited JSON protocol version 1. Replies
echo `sessionId` and `proof`, carry a monotonic cursor, and are limited to 32
records/256 KiB. Missing, incompatible, stale, or mismatched helpers fail
closed; normal terminal-output activity detection continues as fallback. Raw
journal records remain inside the Terminay Server/extension boundary and only
the existing reduced agent-status projection reaches clients.

## Install, compatibility, and troubleshooting

SSH ships built in, installed offline and enabled by default. Disable or
re-enable it in **Extensions** settings without deleting profiles; a compatible
npm release may override the bundled floor. Create an SSH environment, enter
its host and authentication fields, and approve the presented host key.

It requires Extension API 1.1 and Node.js 22+. Remote agent observation also
requires a compatible `terminay-target-helper`; without it the terminal works
but agent detection fails closed. For failures, verify address, port,
credential, host approval, helper version, and remote `PATH`. Passwords,
private keys, raw journals, and transports never reach clients.

Run `npm test --workspace terminay-extension-ssh`. The opt-in Docker smoke is
`npm run test:e2e --workspace terminay-extension-ssh`; it uses a disposable
local server and test keys, not a real remote host.
