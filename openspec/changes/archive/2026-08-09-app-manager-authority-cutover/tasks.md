## 1. Cutover

- [x] 1.1 Update the shared exact-origin contract, browser host, server
  allowlists, transport classification, verifier, and tests to use
  `app.terminay.com`, verified by the origin contract and verifier suites
- [x] 1.2 Make the production web image serve the manager document only for
  exact Host `app.terminay.com` and verify unknown Hosts still fail closed
- [x] 1.3 Route exact `app.terminay.com` ingress to `terminay-web` and remove
  that exact rule from `terminay-app` while retaining `*.terminay.com` there

## 2. Acceptance

- [x] 2.1 Verify `https://app.terminay.com/` shows **Terminay Connections** with
  the primary **Add connection…** action
- [x] 2.2 Verify the old **Terminay Remote / Your saved sessions** root is no
  longer served
- [x] 2.3 Verify `https://app.terminay.com/.well-known/terminay-release.json`
  identifies the selected source revision
- [x] 2.4 Verify hosted `*.terminay.com` signaling and session traffic continues
  to work
