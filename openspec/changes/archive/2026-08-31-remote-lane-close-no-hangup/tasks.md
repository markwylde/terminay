## 1. Lane close handling

- [x] 1.1 Make `laneCloseHangsUp` false so a lane close while ICE is connected does not tear down the peer, verified by the stream diagnostics tests
- [x] 1.2 Record a channel-state close as a warning naming the channel and `hangup: false`, verified by the stream diagnostics tests
- [x] 1.3 Cover control, assets, and application lane close, verified by `hosted-hydrated-checkpoint-silence.test.mjs`
