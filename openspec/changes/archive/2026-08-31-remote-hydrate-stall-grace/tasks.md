## 1. Hydrate stall grace

- [x] 1.1 Fail `outbound-stalled` only when the first outbound frame is older than the 15-second hydrate grace, verified by `hosted-hydrated-checkpoint-silence.test.mjs` covering the four-second handshake pause and the post-grace fail
- [x] 1.2 Classify peer-closed `outbound-stalled` and required-lane close so Desktop's `reasonClass` is not `other` for those failures, verified by the reason classification assertions
