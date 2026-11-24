## 1. Fast overview

- [x] 1.1 Add `usage: false` to `BotEnvironmentService.overview()`, skipping stats, the home-size helper, and the log, and run those reads concurrently when requested. Verify with a `bot-environment` test that a state-only overview issues no `stats`, `run`, or `logs` call, and that the full overview still reads every figure.
- [x] 1.2 Make the state read use the AppArmor decision only once settled, judging currency by fingerprint otherwise. Verify with a `bot-apparmor` test on a cold AppArmor engine that the state read issues no probe `run` and returns, while the full read still waits for the decision.
- [x] 1.3 Pass the flag through the overview query, add optional `usageRead` to the protocol type and parser, and the `usage` option to `BotEnvironmentClient.overview()`. Verify with the server-core and client-core builds and a protocol test that an overview without `usageRead` (an older server) parses, and one with a non-boolean `usageRead` is refused.
- [x] 1.4 Load the Overview state first, then usage, on open and Refresh only; lifecycle changes re-read state only. Drop responses from older loads and a state response that lands after its load's full response; keep figures with their read time during Refresh; show unavailable figures as — and the failure when the full read fails. Verify with `bots-ui` tests: request order on open; lifecycle Start issues only state reads; a delayed state response does not overwrite the full one; a failed full read shows — and the error, not "Reading…".

## 2. Views never start the machine

- [x] 2.1 Stop `BotShellService` starting the container for a shell, refuse a shell while it is not running, and keep sign-in starting it. Verify with `bot-shell` tests: a stopped machine is refused with `conflict` without starting or reserving activity, and sign-in still starts it.
- [x] 2.2 Refuse a desktop on a stopped machine with the same `conflict` refusal. Verify with a `bot-rfb` test.
- [x] 2.3 Add `BotMachineGate` around Shell and Desktop, and remove Desktop's note for a stopped machine. Verify with `bots-ui` tests that a stopped bot's Shell and Desktop show "Machine not started.", open no stream, show no error, and Start sends the start lifecycle command; that not-created, failed, and starting states show Create machine, Try again, and a disabled action; that a refused start shows its cause; and that the view opens when the machine becomes running and gives way to the panel when it stops. Capture the `environment-shell-stopped` and `environment-desktop-stopped` screenshots.

## 3. Verification and sync

- [x] 3.1 Run `openspec validate bot-environment-fast-overview --type change` and `openspec validate --all`. Verify this change is valid and `--all` reports no failure in it or in `spec/bot-environment`.
- [x] 3.2 Run the Bots E2E suite through `npm run test:e2e`, including the new unstarted-machine test, and run CI on the pull request. Verify the suite passes locally and every pull-request status is `success` or `skipped`.
- [x] 3.3 Archive the change so its deltas fold into `openspec/specs/bot-environment/spec.md`. Verify with `openspec validate --all --archived` that the archived change and the synced spec are valid.
