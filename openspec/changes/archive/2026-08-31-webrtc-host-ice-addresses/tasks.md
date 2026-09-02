## 1. Host candidate collection

- [x] 1.1 Collect usable addresses from `os.networkInterfaces()` and verify the
  collected set omits link-local addresses
- [x] 1.2 Pass the collected addresses as `iceAdditionalHostAddresses` when
  signaling is not loopback, and verify the loopback case still pins to a single
  address
- [x] 1.3 Verify candidate addresses do not reach logs or diagnostics

## 2. Verification

- [x] 2.1 Extend `hosted-peer-lifecycle.test.mjs` to cover LAN, Tailscale CGNAT,
  and loopback pin cases, and verify the suite passes
