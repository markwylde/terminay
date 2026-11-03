## 1. Verify the pinned runtime

- [ ] 1.1 Resolve the native Claude executable installed by ACP 0.99.1 / SDK 0.3.312 on Linux amd64 and arm64; verify version, subscription auth-login help and auth-logout help in the bot image. Record results; revise design if the SDK binary lacks these commands.
- [ ] 1.2 Verify the container’s browser URL and authorization-code fallback without a loopback port forward. Use a dedicated test account for live approval; record any unavailable live verification explicitly.

## 2. Add guided sign-in

- [ ] 2.1 Expose that compatible executable in the generated image as `claude`; verify deterministic image fingerprint changes, both supported architecture resolutions and clear failure on missing runtime with image-layer tests and a real image build.
- [ ] 2.2 Declare Sign in with Claude, its subscription login and logout commands, and URL/code-paste help in the built-in manifest; verify contribution validation, existing Profile rendering, and packed extension tests.
- [ ] 2.3 Reuse the server-owned sign-in terminal lifecycle; verify stopped-container startup, interactive code input, success, cancellation, failure, retry and sign-out through composition/shell tests. Make only the lifecycle adjustments those tests require.

## 3. Prove credential ownership and selection

- [ ] 3.1 Verify the pinned adapter uses a saved login with no injected credential variables, and selected token/API-key modes override a retained login in both switching directions. Cover invalid-key no-fallback behaviour with adapter conformance tests; fix launch selection if needed.
- [ ] 3.2 Verify a dedicated test login persists across stop/start and recreation retaining the home, uses owner-only credential-file permissions, supports concurrent same-bot execution through CLI-owned refresh coordination, and is removed by logout/home deletion. Keep token values out of test evidence and Terminay output; report any unavailable live refresh check explicitly.
- [ ] 3.3 Verify no host credential access or sharing between bots is added, and auth rejection remains visible with a sign-in retry path. Use existing credential-boundary tests and targeted integration coverage.

## 4. Documentation and validation

- [ ] 4.1 Update built-in adapter documentation and reconcile the older active bot-change Claude-only-token scenarios with this contract; verify no accepted ADR is edited and all affected specs validate.
- [ ] 4.2 Run relevant server-core and built-in extension checks plus guided-login UI coverage through `npm run test:e2e` in Docker. Record results and any limitations; run `openspec validate --all` and `openspec validate --all --archived`.
