## 1. Scope

- [x] 1.1 Drop a generation from `HostedGenerationSet` on lifecycle failure and close all generations on host stop, verified by `hosted-generation-set.test.mjs`
- [x] 1.2 Add a reconnect-storm test proving only the live generation is retained
- [x] 1.3 Set the device signaling refresh delay to twenty minutes after register and verify refresh does not accumulate closed peers
