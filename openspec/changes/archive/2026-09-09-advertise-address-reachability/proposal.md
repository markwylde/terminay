## Why

An operator follows the documented way to reach a local container — `daemon install --advertise-address 127.0.0.1:42424` — pairs from Firefox, and the connection hangs, then reports that Terminay did not open the api bootstrap lane. The same install pairs instantly from Chrome. Nothing in the CLI output, the journal, or the error names the difference.

Firefox never sends a single connectivity check to a remote loopback candidate. Captured from Firefox 155 against a container installed exactly as documented:

```
remote: host 127.0.0.1:42424, host ::1:42425, host 10.88.1.127:42426, srflx …
pairs:  failed sent=0, failed sent=0, failed sent=0
```

Re-pointing the same container at the host's LAN address and changing nothing else:

```
remote: host 192.168.2.218:42424
pairs:  succeeded recv=4      ice: connected
```

So the flag's headline example is a value that works in one browser family and silently hangs in the other. The address that works everywhere is the machine's routable address, which is also the address the published container port is reachable on.

A second defect made this cost more than it should: re-running `daemon install` with a different `--advertise-address` rewrites the service environment but leaves the running process untouched, so the operator tests the old address and concludes the new one is broken too.

## What Changes

- **BREAKING** `--advertise-address` refuses a loopback host (`127.0.0.0/8`, `::1`), naming why it cannot work and pointing at the machine's routable address. An install that carries one today keeps running; the refusal applies when the value is next supplied.
- `daemon install` restarts the service when it is already running, so a re-run with changed options takes effect rather than being written and ignored.
- The flag's help text, the daemon runbook, and the README stop using a loopback address as the example.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `daemon-cli`: the advertised-address flag refuses loopback; a re-run of `install` restarts the service so a rewritten environment takes effect.

## Impact

- `apps/terminay-cli/src/args.ts` — advertised-address validation and help text
- `apps/terminay-cli/src/systemd.ts`, `apps/terminay-cli/src/commands/install.ts` — restart on re-install
- `README.md`, `docs/operations/` — the documented example address
