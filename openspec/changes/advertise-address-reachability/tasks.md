## 1. A loopback advertised address is refused

- [x] 1.1 Refuse a loopback host in `--advertise-address` across `127.0.0.0/8` and `::1`, with a message that says a browser need not probe a loopback candidate and names the machine's routable address as the replacement; verified by unit tests over the refused forms and an accepted routable one
- [x] 1.2 Assert nothing is written when the value is refused, so a failed install leaves no half-configured machine; verified by a test running install with a loopback address and asserting no unit, environment file, or version directory appears

## 2. A re-install leaves the service on what it just wrote

- [x] 2.1 Add `restart` to the systemd helper and restart the unit when install finds it already active; verified by a test asserting the systemctl calls for an install over a running service include a restart
- [x] 2.2 Keep `enable --now` the path for a machine with no running service, so a first install is unchanged; verified by a test asserting no restart is issued when the unit is inactive

## 3. The documented address is one the CLI accepts

- [x] 3.1 Replace the loopback example in the `--advertise-address` help text with a routable address; verified by a test asserting the help text carries no loopback example
- [x] 3.2 Update the container runbook and the CLI README to install with the machine's routable address, keeping the published-port note beside it; verified by a test asserting neither document tells an operator to advertise a loopback address

## 4. Proving it end to end

- [x] 4.1 Extend the systemd container smoke to assert that installing with a loopback advertised address fails and installing with a routable one succeeds and restarts a running service; verified by the smoke passing under `TERMINAY_RUN_DAEMON_SMOKE=1`
- [x] 4.2 Run `openspec validate --all` and `npm run test:ci`; verified by both passing in CI
