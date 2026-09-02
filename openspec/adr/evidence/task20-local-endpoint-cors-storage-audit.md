# Task 20 local endpoint, CORS, and browser storage audit

Date: 2026-07-27

This bounded audit slice covers local server UI endpoint isolation, CORS
denial-by-default, explicit cross-origin headers, and the browser/web
connection host storage boundary.

## Evidence

- `apps/terminay-server/src/localUiServer.ts` stamps local UI, protocol, error,
  and event-stream responses with CSP, permissions policy, referrer policy,
  `nosniff`, `Cross-Origin-Opener-Policy: same-origin`, and
  `Cross-Origin-Resource-Policy: same-origin`.
- `apps/terminay-server/test/local-ui-server.test.mjs` verifies:
  - unauthenticated local endpoints fail closed;
  - local endpoints do not emit `Access-Control-Allow-Origin`;
  - a hostile-origin `OPTIONS` preflight for the authenticated protocol endpoint
    is rejected with 405;
  - URL query credentials are rejected;
  - authenticated asset, protocol JSON, and event-stream responses carry the
    security headers.
- `apps/terminay-web/test/connection-host.test.mjs` verifies:
  - the web manager persists only sanitized profile metadata;
  - reconnect grants, pairing fragments, tokens, terminal output, query
    credentials, and fragment-bearing origins are not restored from browser
    storage;
  - the web host still refuses loopback/local profiles and only opens exact
    HTTPS session origins.

## Scope limit

This slice does not claim a complete Desktop primary-window audit, dialog
review, real browser engine CORS/preflight automation, mobile browser storage
testing, or packaged Desktop/server UI execution. The parent Task 20 security
audit remains open until the remaining platform-specific UI areas are covered.
