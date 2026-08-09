# Server foundation decisions

This record captures the selected foundations and the evidence still required
by [task 3](../tasks_completed/3-server-architecture-decision-spikes.md). A decision is
not treated as proven merely because it appears here.

## Runtime baseline

- The build and release baseline is Node 24.14.0 with npm 11.9.0. Runtime,
  container, CI, release, and local version-manager pins move together.
- TypeScript and esbuild compile active application code for ES2022 and Node 24
  respectively; active build configuration must not retain a Node 22 target.
- Desktop embeds the same packaged server payload distributed for standalone
  use.
- Platform artifacts include a pinned Node runtime rather than relying on a
  machine-global Node installation.

Evidence below that names Node 22.23.1 records the runtime on which the
original decision spikes were executed. It remains historical evidence rather
than a statement of the current runtime baseline; Node 24 release lanes must
requalify the corresponding active artifacts.

## State repository

### Decision

Terminay Server uses SQLite through the pinned runtime's `node:sqlite` adapter,
behind a repository interface and a dedicated storage worker.

The repository uses:

- WAL journaling;
- `synchronous=FULL`;
- foreign keys;
- a bounded busy timeout;
- one serialized writer;
- `BEGIN IMMEDIATE` for canonical mutations;
- numbered transactional migrations;
- an explicit migration ledger;
- integrity checks and recoverable backups; and
- one transaction for object state, revision/event, trust, and audit changes
  that belong to the same command.

Terminal stream data does not enter the workspace database hot path.

### Rationale

The existing JSON stores cannot atomically commit workspace, revision, trust,
and audit changes together. Whole-file temp/rename improves one file but does
not provide multi-object transactions, revision lookup, or a migration ledger.

SQLite is present in the pinned Node runtime and avoids adding another native
module distribution matrix. `better-sqlite3` remains a fallback if packaging
or runtime support fails on a declared platform.

### Backend comparison

“Proven” below means the Terminay spike exercises the property on the pinned
Node 22.23.1 runtime. A SQLite engine capability is not treated as Terminay
evidence for an adapter that was not run.

| Requirement | Current JSON / temp-rename stores | `node:sqlite` | `better-sqlite3` |
| --- | --- | --- | --- |
| Atomic multi-object commits | No. Rename can atomically replace one file, but separate workspace, revision, trust, and audit files can disagree after interruption. A custom transaction journal would amount to a new database layer. | Proven for workspace state and its revision row in one transaction. The same transaction can cover the remaining canonical tables. | SQLite supports the same transaction boundary, but the Terminay adapter is unimplemented and unproven. |
| Revision lookup | No current ordered revision index. A bespoke append log and index could provide one. | Proven with an indexed revision table and ordered lookup. | Capable through the same schema; unproven in Terminay. |
| Numbered migrations and ledger | No current cross-store schema ledger. Per-file normalization does not establish one committed database version. | Proven with version, name, checksum, and application time in the same transaction as schema changes. | Capable through the same schema; unproven in Terminay. |
| Interrupted migration recovery | A coordinated rollback copy/journal and idempotent recovery protocol would have to be designed and tested. Current stores do not provide it. | Proven: process death after transactional DDL and ledger insertion leaves neither visible; retry applies the migration once and checksum-validates later runs. | SQLite transactional DDL is available, but the adapter and recovery runner are unproven. |
| Corruption detection and recovery | JSON parsing detects malformed syntax, but not valid yet mutually inconsistent files. There is no whole-state integrity check or proven recovery path. | Proven for a damaged database header using open/integrity failure, a validated backup, and recovery beside the unchanged corrupt evidence. SQLite also provides `integrity_check`; broader corruption cases remain unproven. | Exposes SQLite integrity facilities; no Terminay corruption/recovery proof. |
| Recoverable backup/restore | A consistent backup requires quiescing every related store plus a manifest and validated restore procedure. None exists. | Proven with the online SQLite backup API, integrity validation, and restore to a distinct path without overwriting the corrupt canonical file. | Provides backup mechanisms, but no Terminay backup/restore proof. |
| Concurrent readers and serialized writers | Requires process-wide locking, read snapshots, and lost-update prevention designed above filesystem APIs. Current stores have no such contract. | Proven: WAL readers see the last commit while a writer is open; a second `BEGIN IMMEDIATE` receives bounded `SQLITE_BUSY`; expected-revision validation rejects a stale client without mutation. | SQLite WAL and writer serialization are available; Terminay behavior is unproven. |
| Native distribution | Uses built-in filesystem APIs, but meeting the other requirements requires substantial custom persistence code. | Included in the pinned Node executable; no additional native add-on or target matrix. The Node 22 API remains Stability 1.1/active development, so the repository adapter and pinned runtime are mandatory boundaries. | Adds a native Node-API module and its prebuilt/source-build compatibility to every standalone target. Upstream advertises LTS and major-platform prebuilds; the exact Terminay artifact matrix is unproven. |
| Node 22 support | Uses stable Node filesystem APIs. | `DatabaseSync` is present from Node 22.5.0 and online backup from 22.16.0. The complete spike passes on the pinned Node 22.23.1 runtime. | Upstream supports maintained Node releases, including Node 22, but Terminay has not installed or executed the candidate on its artifact matrix. |

The JSON option is simpler only while each file is an independent cache. It is
not simpler for one canonical, revisioned, multi-client authority. Both SQLite
adapters meet the data-model shape; `node:sqlite` is selected because the
pinned server runtime already contains it. `better-sqlite3` is retained only
as the repository-interface fallback if the pinned Node API or a declared
platform fails a release gate.

### Evidence

`scripts/server-state-sqlite-crash.test.mjs` runs five isolated proofs:

- process death before commit restores the prior workspace and revision rows;
- process death after commit preserves the complete next revision;
- process death after transactional DDL and migration-ledger insertion rolls
  both back, after which repeated migration runs apply exactly once;
- an online backup at revision 2 restores a valid database beside a deliberately
  corrupted revision-3 database while the corrupt file's SHA-256 remains
  unchanged; and
- a reader remains available during an uncommitted WAL write, a competing
  writer receives bounded `SQLITE_BUSY`, and an expected-revision mismatch
  returns a conflict without creating revision 3.

Every reopened valid database returns `PRAGMA integrity_check = ok`. The suite
passes under the pinned Node 22.23.1 runtime as well as the development runtime.
It uses the real `node:sqlite` adapter, `WAL`, `synchronous=FULL`, foreign keys,
`BEGIN IMMEDIATE`, and the Node online-backup API.

The proof does not establish physical power-loss behavior on every filesystem,
recovery from every possible page/WAL corruption pattern, migrations that use
non-transactional SQLite operations, sustained production contention, backup
retention policy, or the Task 5 repository/worker integration. Those remain
release, migration-design, and implementation gates rather than inferred
properties of this spike.

## Vault

### Decision

Server services use a vault interface with these capabilities:

- status;
- unlock and lock;
- list secret metadata;
- put, replace, and delete;
- rewrap the data-encryption key; and
- `withSecret`, which supplies plaintext only to a server-side callback.

Vault entries use AES-256-GCM with a unique random nonce and authenticated data
binding server id, secret id, and schema version. A random data-encryption key
is wrapped by a platform-specific key protector and is never stored raw.

Embedded Desktop uses Electron safe storage to wrap the key only where the
selected backend provides real OS protection. Linux `basic_text` is rejected as
a secure protector. Headless servers wrap the key with a passphrase-derived key
using scrypt, read interactively from `/dev/tty` or once from an inherited
key-file descriptor suitable for service-manager credentials.

Command-line arguments, environment variables, and plaintext key files beside
the database are not accepted unlock mechanisms.

### Evidence

`scripts/vault-reference.mjs` provides the extraction-shaped vault interface and
two executable key protectors without selecting a production repository. Its
version-1 envelope fixes AES-256-GCM, 96-bit nonces, 128-bit tags, canonical
tuple AAD, a 256-bit data-encryption key, and scrypt at N=32768, r=8, p=1 with a
128-bit random salt and a 64 MiB resource ceiling. The parser accepts exactly
those parameters before doing KDF work, preventing persisted metadata from
inflating unlock resources. Serialized envelopes are limited to 8 MiB, 4096
entries, and 1 MiB per secret. A data-encryption key is limited to fewer than
2^32 AES-GCM invocations and every entry uses a random nonce; currently active
same-key nonce duplication is rejected.

An AES-GCM manifest under an HKDF-SHA-256 key derived from the data-encryption
key authenticates the envelope revision plus exact entry membership, ids,
names, order, and encrypted fields. Renaming, deleting, reordering, or changing
an entry therefore fails unlock. A complete older valid envelope remains
cryptographically valid: rollback freshness is a state-repository concern and
requires the expected canonical revision in the transactional repository.

`scripts/vault-reference.test.mjs` exercises lock, unlock, status, metadata
listing, put, replace, delete, scoped `withSecret`, rewrap, snapshot reload,
passphrase rotation, wrong-passphrase rejection, authenticated manifest
tampering, same-key nonce uniqueness across entry changes and rewrap, bounded
input, and best-effort buffer zeroization. An atomic two-snapshot fixture is
killed after temporary-file sync, previous-snapshot rotation, and current-file
installation; every state recovers a complete authenticated snapshot, resumes
to the new snapshot, and falls back from an authenticated-corrupt current
snapshot. This is envelope persistence evidence, not the Task 5 repository.
The test also runs the embedded protector against real Electron safe storage
and rejects Linux `basic_text`.

Headless input accepts only an echo-disabled `/dev/tty` read or an inherited
descriptor numbered 3 or higher. Both paths are bounded to 4096 bytes and close
the descriptor. Injected system-call tests prove echo suppression, restoration,
closure, and short-input zeroization; a real pseudo-terminal proves `/dev/tty`
input is not echoed, and a real child descriptor proves one-shot consumption
and closure. Unlock-owned buffers and authenticated-decryption intermediates
are cleared on success and failure. Argv, environment, arbitrary-path, stdin,
and co-located plaintext key mechanisms are not part of the accepted input
schema.

`scripts/safe-storage-import.test.mjs` creates a real safe-storage secret and
fault-injects the source-read, decrypt, vault-encryption, key-wrap, transaction,
entry-write, key-write, ledger-write, and post-commit boundaries. Each case
recovers twice and proves one committed vault entry, one wrapped key, one
completed import-ledger row, and a decryptable matching value. The proof scans
the complete isolated profile, temporary, log, protocol-trace, and crash area
after seeding, failure, recovery, and repeated recovery; the plaintext sentinel
does not persist. Linux `basic_text` returns an insecure-protector rejection
before the legacy secret or vault state is created.

## PTY runtime and distribution

### Decision

Terminay keeps `node-pty` and one supervised child per PTY. The Electron-free
host logic becomes a reusable server module with a small typed process-IPC
entry adapter.

The initial supported distribution matrix is:

- Desktop: macOS 12 Monterey or newer on arm64 and GNU/Linux x64;
- standalone Server: GNU/Linux x64 and arm64 on Debian 12-compatible hosts
  with glibc 2.36 or newer.

macOS x64, Linux arm64 Desktop, Windows, standalone macOS/Windows Server, and
Alpine/musl Linux are outside the initial matrix.

Electron 42.7.1 is the pinned Desktop runtime. Electron removes Monterey
support only in v44 and states that earlier releases continue to run on
Monterey, so the supported Electron 42 macOS floor is macOS 12 rather than the
current build runner version. See Electron's
[macOS 12 removal notice](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support).

Standalone distributions are platform archives containing:

- a pinned Node runtime;
- bundled server JavaScript;
- the matching responsive UI;
- target-specific `node-pty` native files and helpers; and
- a `terminay-server` launcher.

Desktop supervises that exact server payload. It does not contain a second PTY
implementation.

### Required evidence

The same executable probe runs against development Node, Electron Node mode,
the extracted standalone archive, and the packaged Desktop payload. It verifies
spawn, cwd, UTF-8, interactive input, resize, process inspection, inactivity,
exit/signal propagation, descendant cleanup, and bounded shutdown on every
supported native architecture.

## Client-host composition

### Decision

Each Desktop connection window loads one selected server UI in a sandboxed,
origin-bound partition. It uses a dedicated minimal preload; the existing broad
`window.terminay` preload is never exposed to server-provided code.

`app.terminay.com` is a thin parent connection shell containing one
exact-session-origin frame. Cross-origin messages are source-checked,
origin-checked, schema-validated, and limited to sanitized profile display data
and explicit host actions.

### Required evidence

A hostile server-bundle test proves Node, Electron IPC, unrelated partitions,
navigation, downloads, popup, permissions, and credentials are inaccessible.
A browser isolation test proves the parent and sibling session origins cannot
read a session's cookies, IndexedDB, cache, device key, or reconnect grant.

### Electron host evidence

`e2e/server-ui-sandbox.spec.ts` loads a hostile fixture through
`electron/serverUiHost.ts` and its dedicated preload. The proof verifies:

- sandboxing, context isolation, disabled Node integration and webviews, and
  the absence of the broad Terminay and WebRTC-host preloads;
- one exact main-frame origin and opaque persistent partition per connection
  profile;
- a frozen, schema-exact host context/action bridge with rejected extra fields,
  subframes, and unbound senders;
- denied popups, downloads, cross-origin navigation/redirects, notification,
  geolocation, microphone, and ambient clipboard-read permission;
- normal focused keyboard input and user-initiated native paste without
  granting programmatic clipboard reads; and
- cookie, localStorage, and IndexedDB separation between two same-origin server
  windows in different opaque profile partitions.

The factory is not part of normal Desktop startup until the connection-host
implementation task binds each window to a selected server profile.

### Browser host evidence

`e2e/web-client-host.spec.ts` runs a parent connection shell, two exact session
origins, and an attacker origin in Chromium. It verifies:

- exact source, origin, protocol version, and closed-schema validation for
  every host/session message;
- rejection of sibling impersonation and extra-field schema smuggling;
- inaccessible parent/sibling DOM plus separate cookies, IndexedDB, Cache
  Storage, device-key, reconnect-grant, and workspace sentinels;
- responsive iframe sizing, ResizeObserver reporting, keyboard focus/input,
  clipboard permission delegation, sandboxed navigation, CSP `frame-src`, and
  session `frame-ancestors`; and
- rejection when an unauthorized origin attempts to frame a session.

Embedded session cookies use `Secure; SameSite=None; Partitioned` (CHIPS);
ordinary third-party `SameSite=Strict` cookies are not available to the framed
session in current Chromium. Clipboard access requires iframe `allow`,
top-level Permissions Policy, and permission for both the session and
top-level origins. Clipboard permission is therefore an explicit user
capability, not a credential-isolation boundary.

Headless Chromium does not prove mobile soft-keyboard visual-viewport
movement. The separate
[iOS Safari xterm mobile-viewport spike](./evidence/ios-safari-mobile-viewport-spike.md)
loads real xterm inside the exact-origin session frame on an iOS 26.5 Safari
simulator, focuses its helper textarea, types through the actual software
keyboard, keeps the terminal inside the shrunken visual viewport, and restores
the layout after dismissal. Physical-device, rotation, landscape, and complete
release-UI coverage remain release gates rather than foundation blockers.

## Headless WebRTC

### Selected approach

Terminay Server uses a Terminay-owned, deterministic ESM-only artifact derived
from Werift 0.24.1 behind a WebRTC peer adapter. Pairing, authorization,
signaling, and the application protocol remain outside that adapter.

The candidates are:

- `werift`, a pure TypeScript implementation with the lowest native packaging
  risk;
- `node-datachannel`, a native Node-API binding focused on data channels; and
- `@roamhq/wrtc`, a W3C-style native binding.

Terminay formally selects the integrity-pinned, Terminay-owned Werift 0.24.1
ESM artifact described below as its production WebRTC runtime. The
machine-readable selection record is
`build/webrtc-runtime/selection.json`; release packaging and runtime loading
must consume that exact record rather than infer a runtime from installed
packages or environment variables.

The selected runtime passes production signaling, direct and authenticated
TURN-only routing, representative Linux x64/arm64 execution, data-channel
ordering and bounded application pressure, natural shutdown, hardened
two-factor reconnect, and revocation. The published Werift package is not used
unchanged because its stale dependency metadata installs the vulnerable legacy
ICE chain.

The production loader verifies the selected identity and complete deterministic
payload before importing executable code. The fallback is to stop the server
WebRTC adapter with an actionable diagnostic if that artifact cannot be
verified. Terminay does not fall back to the blocked `node-datachannel`
prebuilds or the published Werift package. Native release certification,
sustained multi-peer load, trusted provenance attestation, and update-response
operations remain Tasks 17/20 and do not weaken this selection.

### Candidate comparison

| Candidate | Passing evidence | Selection blockers |
| --- | --- | --- |
| Terminay-owned Werift 0.24.1 ESM artifact | Pure TypeScript displayless session; three ordered channels; bounded transfer; exact production pairing, two-factor reconnect, signed signaling, terminal, revocation, direct ICE, authenticated TURN-only relay, and natural exit; two independent candidate builds have an identical allowlist and hashes; npm tarball, source commit, every retained dependency, notices, source correspondence, and SBOM are pinned; Node 22 and Electron-main/child imports pass; minimized executable graph has zero critical/high npm advisories; the same deterministic artifact passes native Linux arm64 and emulated Linux x64 runtime proofs | Published package unchanged still installs high-advisory `werift-ice -> ip`; native release certification, sustained real multi-peer ceilings, and release integration remain Tasks 17/20 |
| `node-datachannel` 0.32.3 | Displayless Node 22 ordered/binary session; protocol ACK window; clean shutdown; audited isolated install; clean Linux arm64 and emulated x64 execution from published N-API v8 artifacts without a compiler | Published Linux prebuilds statically contain EOL OpenSSL 1.1.1w; macOS/Windows contain OpenSSL 3.6.2 affected by later advisories; the binding predates later libdatachannel DTLS/ICE fixes; a physical/native Linux x64 run and production signaling/TURN/reconnect gates remain; Boolean send result is not a safe acceptance/retry signal |
| `@roamhq/wrtc` 0.10.0 | Displayless Node 22 three-channel session; bounded bidirectional 8 MiB transfer; clean shutdown; audited isolated install | No low-water event; Linux requires glibc 2.34 and ALSA; Linux arm64 support is unconfirmed; bundled libwebrtc M106 needs explicit native security review |

The detailed candidate records are:

- [node-datachannel headless spike](./evidence/node-datachannel-headless-spike.md)
- [node-datachannel native supply-chain audit](./evidence/node-datachannel-native-supply-chain.md)
- [secure Werift production-runtime spike](./evidence/secure-werift-production-spike.md)
- [@roamhq/wrtc headless spike](./evidence/roamhq-wrtc-headless-spike.md)

### `node-datachannel` candidate proof

`scripts/headless-webrtc-node-datachannel.test.mjs` installs exactly
`node-datachannel` 0.32.3 into a fresh temporary project, inspects its native
binary, runs the child proof with a deadline, and removes the temporary project.
The proof creates separate ordered `api`, `asset`, and `terminal` channels,
exchanges 1,000 sequenced messages in both directions on each channel, and
transfers a 16 MiB binary payload through a bounded application ACK window.

The clean Node 22.23.1 Linux lanes install and run from the published native
artifacts without a compiler or native build command:

- native arm64 in an arm64 Podman VM, under 50 ms/20 Mbit loopback shaping; and
- x64 under architecture emulation in the same VM.

The arm64 run observed 253 false `sendMessageBinary` results and the x64 run
observed 196. Neither result caused a retry: sequence framing, receiver
deduplication, acknowledgements, exact byte count, and SHA-256 verification
proved delivery without loss or duplication. This is a required adapter rule
because the Boolean return is not a reliable message-acceptance signal.

Both native modules dynamically require only the matching loader plus standard
system `libdl`, `libpthread`, `libm`, and `libc`, and both child proofs close all
peers/channels and exit naturally without a non-stdio handle.

The complete native audit verifies all 11 release archives and binaries. It
finds statically linked EOL OpenSSL `1.1.1w` in every Linux prebuild,
OpenSSL `3.6.2` affected by later advisories in every macOS/Windows prebuild,
and libdatachannel `0.24.2` before later DTLS/ICE memory-safety and
synchronization fixes. `npm audit` does not cover those components. The
published `0.32.3` binaries cannot be selected as the Terminay payload.

This evidence does not yet select the runtime. A patched and provenance-complete
native payload or different viable runtime, a physical/native Linux x64 run,
production pairing and reconnect signaling, replay/revocation behavior,
STUN/TURN, hostile-network loss and crash behavior, sustained multi-client
resource use, and the Electron-supervised adapter remain selection gates.

### `werift` candidate proof

`werift` 0.24.1 is pinned only in
`scripts/spikes/werift-fixture/package-lock.json`. It is absent from the root
application dependency graph and is not a production runtime selection.

Run:

```sh
npm run test:spike-headless-webrtc
```

The test copies the fixture lockfile and executable proof into a fresh
temporary directory, runs `npm ci --ignore-scripts`, executes the proof from
that isolated project, and removes the complete directory afterward. The
executable proof creates an offerer and answerer in a plain Node process without
Electron, Chromium, a browser, or a display server. It verifies:

- offer, answer, and ICE candidate gathering on both peers;
- separate ordered `api`, `asset`, and `terminal` data channels;
- 32 ordered messages in each direction on every channel;
- an 8 MiB binary asset transfer split into 48 KiB chunks;
- a sender high-water mark of 256 KiB and low-water mark of 64 KiB, using
  `bufferedAmountLow` before sending more data;
- exact chunk order, byte count, and SHA-256 equality at the receiver; and
- closure of both peers and every channel, followed by release of Werift
  sockets and timers before natural process exit.

The test launches the proof in a child Node process and fails if it does not
exit naturally within 15 seconds. This catches an orphan socket or timer that a
same-process unit test could hide.

Evidence recorded on 2026-07-27 with Node 22.23.1 on Darwin arm64:

| Measurement | Result |
| --- | ---: |
| ICE candidates | 4 host, 4 client |
| Offer / answer SDP | 910 / 909 bytes |
| Asset transfer | 8,388,608 bytes in 171 chunks |
| Backpressure waits | 28 |
| Maximum observed buffered amount | 294,912 bytes |
| Asset transfer time | 673 ms |
| Peer/channel close time | 11 ms |
| Total proof time | 923 ms |
| Active resources after close | one stdout `PipeWrap`; no Werift socket or timer |

The same npm test also passes under the local Node 24.14.0 runtime.

This proof is intentionally narrower than the selection gate. It does not
prove the production signaling service, first pairing, saved reconnect,
revocation, signed-signal replay rejection, STUN/TURN, hostile-network
behaviour, Linux x64/arm64 distribution, sustained multi-client resource use,
or security maintenance.

The published package unchanged reports a high-severity advisory through
Werift's legacy `werift-ice -> ip` dependency chain
(`GHSA-2p57-rm9w-gvfp`). Its ESM entry is already bundled from the rewritten ICE
implementation, imports neither legacy package, and has a smaller actual
dependency graph. The separate secure-runtime proof integrity-pins and
minimizes that ESM artifact, records zero npm advisories, and passes the exact
production pairing, two-factor reconnect, signed signaling, asset, terminal,
revocation, and natural-exit flow.

The separate candidate builder proves deterministic source identity, a complete
retained dependency lock, notices and license texts, CycloneDX SBOM, exact file
allowlist and hashes across two builds, Node 22 execution, and import from both
an Electron main process and its server child. The Terminay-owned ESM artifact
is the formally selected release dependency described by the machine-readable
selection record above.

`scripts/production-webrtc-turn-routes.test.mjs` builds and audits that exact
minimized artifact, starts an isolated authenticated coturn instance, and runs
the production `runHost` surface. Its direct browser-to-Werift terminal route
selects a nominated host/peer-reflexive pair. Its forced relay-only
Werift-to-Werift terminal route selects nominated, succeeded relay/relay UDP
pairs at both peers. Separate attempts with a wrong REST credential and an
expired timestamp credential produce no selected pair and no terminal traffic.
The temporary coturn secret remains in a mode-0600 config, is absent from
arguments and environment values, and is checked against captured output.

The settings parser accepts the legacy comma-separated URL form and a strict
structured JSON form. The structured form preserves paired TURN username and
credential fields through `RemoteAccessService` into `HostConfig`; bounded
entry/URL counts, scheme validation, unknown-key rejection, and redacted errors
keep that configuration surface closed.

The direct/TURN route proof, production-host pressure tests, revocation tests,
and cleanup tests close the Task 3 transport-viability gate. Native release
certification, sustained real multi-peer ceilings, and release integration
remain Tasks 17/20.
