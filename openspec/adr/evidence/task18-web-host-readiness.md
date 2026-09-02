# Task 18 web-host readiness evidence

The local readiness gate is `scripts/task18-web-host-readiness.mjs`, exercised
by `npm run test:task18-web-host-readiness` and included in both CI release
validation paths.

It deterministically verifies the checked-out `@terminay/web` package and its
built output:

- the package exports its JavaScript and declaration entry points from `dist`;
- the manager origin is exactly `https://web.terminay.com`;
- the browser host starts without a Local profile;
- manager navigation is stable; and
- session navigation is exact-origin and route-only.

The result includes byte sizes and SHA-256 digests for the JavaScript and
declaration artifacts, with no timestamps or network-derived values. The gate
does not make HTTP/DNS/TLS/CDN requests and intentionally reports
`externalDeploymentVerified: false` and `publicDnsVerified: false`. The broad
deployment checkbox remains open until an actual hosted deployment is verified.
