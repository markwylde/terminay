## 1. Remove stall as a hang-up cause

- [x] 1.1 Make `shouldFailHostedStall` always false so an outbound-silence stall
  is logged only, verified by reading the hosted stall path
- [x] 1.2 Confirm hang-up remains limited to user disconnect, required-lane loss,
  and WebRTC `failed`/`closed`, verified by the hosted host's failure branches

## 2. Regression coverage

- [x] 2.1 Test that five seconds of outbound silence does not close the peer,
  verified by `hosted-hydrated-checkpoint-silence.test.mjs` passing
