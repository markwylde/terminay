## 1. Reproduce

- [x] 1.1 Add an optional `loadRuntime` seam to `HostedPairingHostOptions` that production never sets, verified by a test that the default path still calls `loadSelectedSecureWeriftRuntime`
- [x] 1.2 Write `apps/terminay-server/test/hosted-pairing-auth-starvation.test.mjs` with a fake runtime whose `addIceCandidate` never settles, driving `client-join`, answer, one candidate, then `application-auth` with a valid ticket, verified by the test failing on the current host with the reply absent after 2 s
- [x] 1.3 Extend `hosted-pairing-approval-flow.test.mjs` so the client trickles a late candidate after its lanes open and immediately before `application-auth`, verified by the assertion on the reply time

## 2. Fix

- [x] 2.1 Consume the ticket and send `application-authenticated` directly in `bindControl`, removing `serialize` from `HostContext`, verified by the starvation test passing
- [x] 2.2 Add `createDeviceReplacementChain()` to `hostedPeerLifecycle.ts` and run `livePeers.close(deviceId)` plus `acceptAuthenticatedApplication` inside the device's chain, dropping drained entries, verified by a unit test that two peers for one device attach in order while another device is unaffected
- [x] 2.3 Keep the liveness source assertions current in `hosted-pairing-host-liveness.test.mjs`, verified by that suite passing

## 3. Prove and ship

- [x] 3.1 Run the server, protocol, and affected script suites locally and push a branch, verified by Gitea CI green on the pull request
- [ ] 3.2 Pair a browser against the running Desktop on the deployed relay once merged, verified by the workspace attaching without the authentication timeout
