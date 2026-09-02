## 1. Host liveness and ICE

- [x] 1.1 Apply the same STUN and TURN list the browser receives for that exposure to the host peer, verified by the ICE-server wiring test
- [x] 1.2 Evaluate Werift peer and ICE state on each connected peer, start one bounded grace period for a recoverable `disconnected`, and replace or close that peer once on `failed`, `closed`, or grace expiry without closing other live clients or PTYs, verified by the ICE grace tests
- [x] 1.3 Serialize `client-join` and `device-join` for one signaling socket so a second join retires an incomplete handshake only, an authenticated connected peer stays up, and answers and ICE candidates apply only to the current handshake generation, verified by the join serialization tests
- [x] 1.4 Keep application-protocol reader completion as failure of that peer generation and add a host test where ICE goes `disconnected` while the application lane stays `open`, verified by that test
