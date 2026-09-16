## 1. Accept omp 18.2 breadcrumbs

- [x] 1.1 In `extensions/agent-omp/src/ompAgent.ts`, make `parseBreadcrumb` read the lines after the session-file path as a bounded set of markers, accepting `fresh` and `cwdstat <digits> <digits>` once each and refusing anything else. Verified by `npm test` in `extensions/agent-omp`: a breadcrumb with the `cwdstat` line binds, with and without `fresh`, and unknown, repeated, or excess markers fail closed. The binding case fails on the previous parser.

## 2. Checks

- [x] 2.1 Run `openspec validate --all` and `npm run lint`. Verified by both reporting clean.
- [ ] 2.2 Read back the `Agent conformance / agent-omp` status on the pull request head and confirm it is `success`. Verified by the status listing itself.
