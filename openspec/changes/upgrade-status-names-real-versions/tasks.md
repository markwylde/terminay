## 1. Fix

- [x] 1.1 Report a rolling build's manifest version as `available` and `latest` in `daemon upgrade --check`, and the installed version when the build is the installed one. Verified by `apps/terminay-cli/test/check.test.mjs` with a Canary archive whose manifest names `6.10.0-main.3428.canary`.
- [x] 1.2 Report the process's own version in the upgrade status, falling back to the install record only for `0.0.0`. Verified by `packages/server-core/test/server-upgrade-service.test.mjs`: a server started at 5.2.0 over a record still naming 5.1.1 reports 5.2.0.
