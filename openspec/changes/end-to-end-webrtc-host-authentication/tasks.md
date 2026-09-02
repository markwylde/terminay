## 1. Transcript contract

- [x] 1.1 Define one dependency-light versioned transport-transcript schema and canonical byte serialization in the shared protocol package, verified by deterministic vectors
- [x] 1.2 Bind the domain and version, pairing or reconnect scope, room or session id, origin, server id, host public key and algorithm, fresh client nonce, offer or generation id, issued and expiry times, exact SDP hash, and the complete normalized DTLS fingerprint set, verified field by field
- [x] 1.3 Reject unknown fields, duplicate or unsupported fingerprints, ambiguous encodings, unsafe times, and oversized values, verified by parser tests

## 2. Server-side authentication

- [x] 2.1 Add a dedicated fragment-derived HKDF key for first-pairing transport authentication and verify the server MACs the canonical transcript and host public key
- [x] 2.2 Keep that key, the fragment, and any reusable derivative out of signaling, URLs, logs, analytics, and persisted room metadata, verified by a leakage test over routed traffic
- [x] 2.3 Create the hosted WebRTC offer only after receiving a bounded fresh client nonce, verified by an ordering test
- [x] 2.4 Extract the actual local DTLS fingerprints, hash the exact transmitted SDP bytes, sign the canonical transcript with the persistent Ed25519 host key, and send transcript, signature, and pairing authenticator with the offer as one generation-bound message, verified end to end
- [x] 2.5 Keep host registration proof as a signaling availability control separated from client-verified transport authentication, and update the hosted signaling contract to route the new closed message shapes without interpreting trust or learning secret material, verified by contract tests

## 3. Client verification and pinning

- [x] 3.1 Verify scope, origin, server id, nonce, freshness, generation, exact SDP hash and fingerprints, pairing authenticator when pairing, and host signature before `setRemoteDescription` or any data-channel credential exchange in the browser first-party and framed-PWA hosts, verified by test
- [x] 3.2 Close the generation and produce a typed visible trust error on any validation failure, verified per failure class
- [ ] 3.3 Apply the same pre-SDP authenticated transport contract to the privileged Desktop native WebRTC connection host, verified by the shared vectors
- [x] 3.4 Persist the verified host public key and algorithm atomically beside each browser and PWA device credential and accept only that pinned key on reconnect, verified by restart tests
- [ ] 3.5 Persist the verified host pin atomically beside each privileged Desktop device credential and require it on reconnect, verified by restart tests
- [x] 3.6 Gate every hosted-browser sensitive operation on transport authentication — PIN or approval, device enrollment and public key, device challenge signing, connection ticket, UI archive, host context beyond non-secret bootstrap, application authentication, and application and terminal frames — verified by an embargo test
- [x] 3.7 Ensure retired or failed generations cannot reuse a verified flag, transcript, nonce, signature, authenticator, offer id, or ticket, verified by replay tests
- [x] 3.8 Define browser and PWA restore and rotation behaviour so preserving a server identity preserves its host key and deliberate rotation invalidates device trust, verified by restore and rotation tests

## 4. Security tests and release evidence

- [x] 4.1 Unit-test canonical serialization and parsing, Ed25519 algorithm boundaries, fragment-derived authentication, signature verification, expiry, nonce equality, SDP-byte hashing, fingerprint normalization, and pin persistence with deterministic vectors shared by server, browser, and Desktop
- [ ] 4.2 Add an adversarial signaling harness that attempts two independent WebRTC connections while relaying valid pairing enrollment and reconnect challenges, verifying endpoint substitution fails before the client sends a PIN, public device key, device signature, ticket, bundle request, or application frame
- [ ] 4.3 Mutate each signed field independently plus SDP whitespace and bytes, fingerprints, host key, signature, pairing authenticator, nonce, generation id, scope, replay order, and expiry, verifying every mutation fails closed and delayed or duplicated valid messages cannot revive a retired generation
- [ ] 4.4 Prove honest signaling and TURN relay paths still pair, persist the pin, reconnect after browser and Desktop restart, recover transport generations, revoke devices, and carry the server-bundled workspace without creating duplicate PTYs
- [ ] 4.5 Run Electron acceptance only through the container E2E command, add the hostile-relay proof to release-required security evidence, and verify a build cannot advertise remote access when its client or server lacks the authenticated transport contract version
