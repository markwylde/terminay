## 1. Server

- [ ] 1.1 Add `--advertise-address` and `TERMINAY_WEBRTC_ADVERTISE_ADDRESS` to `apps/terminay-server/src/cliOptions.ts`, parsing a literal IPv4 or IPv6 address with a port and rejecting hostnames, missing ports, and out-of-range ports; verified by parser unit tests covering IPv4, bracketed IPv6, a hostname, a bare address, port 0, and port 65536
- [ ] 1.2 Wire the parsed value into `hostedPeerConfiguration` as `iceAdditionalHostAddresses` plus `icePortRange` pinned to that single port, leaving the loopback-signaling branch untouched; verified by unit tests asserting the produced configuration contains the advertised address, pins the port, and still contains the gathered addresses in their original order
- [ ] 1.3 Fail startup with a message naming the advertised address when it cannot be parsed or its port cannot be bound, including the port-already-in-use case; verified by a test that binds the port first and asserts the server exits non-zero naming that port
- [ ] 1.4 Assert the advertised address changes nothing about authentication: same pairing URL, same session origin, same host-key proof, and no application data before verification; verified by extending the existing transport-authentication tests with an advertised-address case

## 2. CLI

- [ ] 2.1 Add `--advertise-address` to the parser for `install` and `upgrade`, validating before anything is written, with `''` clearing it; verified by parser tests covering a valid value, a hostname, a malformed value, and the clearing form
- [ ] 2.2 Persist it in the install record and the environment file, and keep the recorded value on `upgrade` when the flag is absent; verified by tests on a temporary prefix asserting the record and environment file after install, after upgrade without the flag, and after upgrade clearing it
- [ ] 2.3 Print the UDP port that must be reachable after an install that supplied one; verified by asserting the install output names the port
- [ ] 2.4 Report the advertised address in `daemon status`, and assert the report still names no path, account, or device; verified by extending the existing status redaction test

## 3. Proving it works

- [ ] 3.1 Add a test that a published UDP port round-trips through the container runtime, so the assumption the design rests on fails loudly if a runtime stops honouring it; verified by the test passing under `TERMINAY_RUN_DAEMON_SMOKE=1`
- [ ] 3.2 Extend the systemd container smoke to install with `--advertise-address` and assert the server offers that candidate; verified by the smoke passing
- [ ] 3.3 Connect Terminay Desktop to a containerised server on the same machine through hosted signaling, and record the result as evidence; verified by the peer reaching a connected state over the advertised candidate

## 4. Documentation

- [ ] 4.1 Document the local-container flow in `docs/operations/standalone-server.md`: the `docker run` publishing the UDP port, the `daemon install`, the pairing step, and why the container's own address does not work; verified by review against the `daemon-cli` spec
- [ ] 4.2 Add the same flow to the CLI README, and state that the flag is for a server reachable only at a forwarded address rather than a general NAT fix; verified by review
- [ ] 4.3 Run `openspec validate --all`, `npm run test:ci`, and the CLI suite; verified by all passing in CI
