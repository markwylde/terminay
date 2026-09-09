## Context

Change `headless-server-release-and-pairing` gives every release and every
merge to `main` a signed, self-contained Linux archive per architecture, a
server that can expose itself at startup in hosted and direct modes, and a
socket operation that returns the live pairing URL. This change builds the
operator-facing tool on top of that: a small npm package whose job is to
resolve a version, verify it, lay it out on disk, drive systemd, and put
pairing and approval in one terminal.

In-force ADRs that constrain this design: ADR-0001 (artifacts carry their own
Node; the CLI's own Node is irrelevant to the server), ADR-0004 (Linux matrix),
ADR-0011 (data root is the trust boundary; owner-only socket), ADR-0013
(approval by match code on the host), ADR-0015 (direct exposure), ADR-0016
(archives, channels, side-by-side install layout). No in-force ADR needs to
be revisited.

## Goals / Non-Goals

**Goals:**
- One command from a clean Linux box to a running, exposed, pairable server.
- Deterministic version selection across tags, `main`, and arbitrary refs.
- Upgrades that cannot leave the machine without a working server.
- Pairing that does not require reading the journal.

**Non-Goals:**
- Non-systemd init systems, Windows, macOS, containers (the Docker image
  remains the container path).
- Vault unlock; deferred to a later change.
- A TUI beyond a few prompts.
- Managing more than one server instance per prefix.

## Decisions

### D1. A thin CLI with Node built-ins and one dependency

`apps/terminay-cli` publishes as `terminay`. It uses `node:https` for
GitHub API and asset downloads, `node:crypto` for SHA-256 and Ed25519
verification, `node:child_process` for `systemctl`, `useradd`, `loginctl`,
and `tar`, `node:readline` for prompts, and `qrcode` for terminal rendering.
No HTTP client, prompt library, or shell framework. It runs on any Node the
operator has because it never loads the server; the server runs on the Node
bundled in its archive (ADR-0001). `engines.node` is `>=20`.

Alternative: making the CLI depend on `@terminay/server`. Rejected: that
pulls a native addon into `npx` and ties the CLI to one server version.

### D2. Version resolution and channels

`resolveRef(ref)`:
- absent → GitHub `releases/latest` → channel `tag`.
- `/^v\d+\.\d+\.\d+/` → `releases/tags/<ref>` → channel `tag`.
- `main` → `releases/tags/main` (the rolling prerelease) → channel `main`.
- otherwise → `git ls-remote` for a branch or commit → channel `source`.

Each resolution yields `{ channel, version, revision, assets }` and picks
`terminay-server-<version>-linux-<arch>.tar.gz` plus `.sha256` and `.sig`.
The installed channel is recorded in `<prefix>/install.json` alongside the
active version and revision. `upgrade` with no ref re-resolves that channel;
`source` installs require an explicit ref because a branch tip has no
ordering the CLI can trust. Ordering: tags compare by semver; `main`
compares by revision inequality (a different revision is "newer" only when
the prerelease's published time is later than the installed one, which the
CLI also records); downgrade detection uses semver for tags and published
time for `main`.

### D3. Verification with an embedded key and no bypass

The Ed25519 public key is committed to the CLI source as a PEM constant.
`verifyArchive(archive, sidecar, sig)` recomputes SHA-256, compares with the
sidecar, then verifies the signature with `crypto.verify(null, ...)`, the
same call `scripts/release-signature.mjs` uses. A CI step compares the
embedded key with `TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64` and fails the
release on mismatch. There is no skip flag; the boundary crossed is
"release pipeline → operator's machine" and the key is the only thing making
the download trustworthy. If signing turns out to be unavailable for a
release, the release is blocked, not the check.

### D4. Source build fallback

For `source` channel the CLI runs, as the invoking user in a temporary
directory: preflight (`git`, `python3`, `make`, `c++`), `git clone --depth 1
--branch <ref>` or clone plus checkout for a commit, `npm ci` with the
repository's pinned npm, `npm run build:application-graph` and
`build:server-postcompile`, download of the pinned Node archive named in
`scripts/pty-runtime-platforms.mjs`, then
`scripts/build-standalone-server-artifact.mjs --channel source`. The output
archive is installed through the same `installArchive` path, skipping the
signature check only because there is no publisher; the manifest is still
verified with `scripts/standalone-artifact.mjs`. The temporary directory is
removed on success and kept on failure with its path printed.

### D5. Install layout and atomic activation

```
<prefix>/versions/<version>/         archive contents, immutable
<prefix>/current -> versions/<v>     symlink, replaced via rename
<prefix>/install.json                channel, version, revision, publishedAt, scope, runAs
system:  /opt/terminay, /etc/terminay/server.env, /var/lib/terminay,
         /etc/systemd/system/terminay-server.service
user:    ~/.local/share/terminay, ~/.config/terminay/server.env,
         ~/.local/share/terminay/data, ~/.config/systemd/user/terminay-server.service
```

Activation writes `current.tmp` then `rename`s it over `current`. Rollback is
the same operation in reverse. Retention keeps the active and one previous
version. `upgrade` follows `docs/operations/release-update-policy.md`
step for step: verify, stage, stop, switch, start, readiness, else roll back.
Readiness is `GET /readyz` on the loopback health port with a 60 s deadline.

### D6. Scope and run-as prompts

Prompts appear only when `process.stdin.isTTY` and the flag is absent; the
first option is preselected and Enter accepts it. System scope requires
`process.getuid() === 0` and otherwise prints the `sudo` form of the same
command. User scope runs `systemctl --user` and `loginctl enable-linger`.
For system scope, `--run-as` defaults to a dedicated `terminay` system user
created with `useradd --system --home-dir /var/lib/terminay --shell
/usr/sbin/nologin`; a named user must already exist. The unit's `User=`,
`Group=`, `WorkingDirectory=`, and the data-root ownership follow the choice.
Boundary crossed: the daemon's PTYs run as that account, so the choice
decides whose files and keys the server can reach; the prompt says so.

### D7. Unit and environment

The unit is the runbook's, generated from a template:
`ExecStart=<prefix>/current/bin/terminay-server`, `Restart=on-failure`,
`RestartSec=5s`, `KillSignal=SIGTERM`, `TimeoutStopSec=15s`,
`NoNewPrivileges=true`, `PrivateTmp=true`, journal output. The environment
file sets `TERMINAY_SERVER_ID=<hostname>` (written once, never rewritten),
`TERMINAY_DATA_ROOT`, `TERMINAY_PROJECT_ROOT=<run-as home>`,
`TERMINAY_EXPOSE=hosted,direct`, `TERMINAY_HOSTED_DOMAIN`,
`TERMINAY_DIRECT_ORIGIN=https://<primary-address>:<port>`,
`TERMINAY_HTTP_HOST=0.0.0.0`, `TERMINAY_HTTP_PORT`, `TERMINAY_HEALTH_HOST=127.0.0.1`,
`TERMINAY_HEALTH_PORT`, `TERMINAY_AGENT_INTEGRATION=enabled`,
`TERMINAY_LOG_SINK=journal`, `TERMINAY_UI_RENDERER_DIRECTORY=<prefix>/current/ui`.
`--port`, `--direct-origin`, `--hosted-domain`, `--expose`, and
`--project-root` override the defaults. The primary address is the source
address of a UDP socket "connected" to a public IP, with `--direct-origin`
as the override for hosts behind NAT or with a DNS name.

### D8. Pairing and approval loop

`daemon qr-code` connects to `<data-root>/approval.sock` as the run-as user
(system scope re-executes itself under `sudo -u <run-as>` for the socket
call when invoked by root). It sends `{ op: 'pairing' }`, renders the chosen
URL with `qrcode.toString(url, { type: 'terminal', small: true })`, prints
all URLs and expiries, then polls `{ op: 'list' }` every second. A pending
approval replaces the QR with the device name and match code and a Y/n
prompt whose answer becomes `approve` or `deny`. With no pending approval and
less than 30 s to expiry it sends `{ op: 'pairing', rotate: true }` and
redraws. `--no-wait` and `--mode` are plain flags. This is the runbook's
"compare the code and run approve" collapsed into one screen; approval still
happens only on the host, as ADR-0013 requires.

### D9. Release publication

`trigger-release.yml` gains a job after the archives are attached:
`npm version <tag> --no-git-tag-version --workspace apps/terminay-cli`,
the embedded-key check, `npm publish --workspace apps/terminay-cli
--provenance --access public`. Credentials: a GitHub Actions repository
secret `NPM_TOKEN` holding an npm granular access token that is publish-only,
scoped to the `terminay` package, with automation bypass for two-factor
authentication; the job declares `permissions: id-token: write` so
provenance attestation works. Publishing after the archives guarantees
`npx terminay daemon install` for that version can resolve its own release.

## Risks / Trade-offs

- [GitHub API rate limits for anonymous `npx` users] → use the
  `releases/latest` and `releases/tags/<tag>` endpoints only (two requests
  per install), honour `GITHUB_TOKEN` if present, and fall back to parsing
  the release page's asset URLs, which are not rate limited.
- [Primary-address guess is wrong behind NAT] → print the derived direct
  origin at install and make `--direct-origin` prominent; pairing still
  works over hosted mode.
- [Root running `npx` executes registry code as root] → document
  `sudo npx terminay@latest` as the expected form and keep the CLI's
  dependency footprint to `qrcode`; pin exact versions.
- [Source builds are slow and fragile on small hosts] → preflight before
  downloading, print expected duration, and keep the build directory on
  failure for diagnosis.
- [systemd is unavailable in the Docker e2e harness] → unit-test against a
  fake `systemctl`, `useradd`, and `loginctl` on `PATH` with a temporary
  root; add one opt-in container smoke on a systemd-enabled image.

## Migration Plan

New package; nothing to migrate. Ship after `headless-server-release-and-pairing`
has produced at least one tagged release with archives, so the first published
CLI can install something. Rollback is unpublishing nothing: an installed
daemon keeps running if the CLI is withdrawn.

## Open Questions

- None. The `NPM_TOKEN` repository secret must exist on GitHub before the
  first tagged release that includes the publish job.
