## 1. Thin browser shell

- [x] 1.1 Limit the deployed manager to connection profiles, pairing and reconnect, signaling and WebRTC bootstrap, bundle verification and installation, isolated session launch, and bounded failure and recovery UI, verified by the manager scope tests
- [x] 1.2 Remove any independently versioned full workspace fallback from the manager artifact and normal module graph, verified by a dependency-boundary check on the built artifact
- [x] 1.3 Install and execute each server bundle only in its exact isolated session origin and never execute unrelated server code or credentials in the manager origin, verified by the origin-isolation tests
- [x] 1.4 Pass only the browser host context and the opaque byte endpoint across a closed exact-source, exact-origin bridge, verified by the host bridge contract tests
- [x] 1.5 Keep `app.terminay.com` canonical with its same-origin sanitized profile metadata and use `web.terminay.com` only as a retired redirect, verified by the manager origin and redirect coverage

## 2. Origin, cache, and credential isolation

- [x] 2.1 Commit verified bundles atomically and keep the previous complete bundle after interruption, invalid hashes, unsafe paths, incompatible requirements, or server-identity mismatch, verified by the bundle cache failure-mode tests
- [x] 2.2 Keep manager persistence metadata-only and keep origin credentials and bundle storage out of profile messages, URLs, logs, and analytics, verified by the manager storage assertions
- [x] 2.3 Preserve direct session-origin launch and a safe route back to connection management without transferring credentials, verified by the session-launch tests

## 3. Cross-version convergence

- [x] 3.1 Prove one server reports the same verified bundle and server-owned identities in Local Desktop, remote Desktop, direct browser, and browser-manager launches, verified by the four-path convergence fixtures
- [x] 3.2 Prove compatible host shells connect across server application versions without interpreting feature frames, verified by the older, current, and newer host and server fixtures
- [x] 3.3 Prove incompatible required boundaries fail before launch with a typed upgrade requirement while optional host capabilities degrade without disconnecting, verified by the compatibility matrix tests
- [x] 3.4 Prove manager, session, and sibling origins and Desktop profiles cannot cross credentials, caches, DOM, transports, or workspace state, verified by the isolation matrix as a release gate
