# Extension author guide

Terminay extensions are ESM npm packages installed and executed by the selected
Terminay Server. Desktop and browser clients receive bounded declarative data;
they never import an extension. The v1 API only adds project-environment
providers.

## Build the first provider

1. Require Node 22 or newer and add `@terminay/extension-api` as a development
   dependency. Do not import Terminay internals.
2. Put a closed `terminay` manifest in `package.json`; copy
   `examples/basic-provider` as a starting point and replace every namespaced id.
3. Export `defineExtension({ activate, deactivate })` from the manifest's ESM
   entrypoint. In `activate`, register each declared provider exactly once.
4. Describe forms and status with API DTOs. Do not ship renderer code, HTML,
   CSS, SVG, routes, or callbacks in presentation objects.
5. Implement all provider runtime callbacks and honour `context.signal` and
   `context.deadlineAt`. Mutations must use the host idempotency key and expected
   revision when supplied.
6. Keep only redacted, JSON-safe state in `providerState`. Resolve secrets only
   inside `secrets.withValue`; never return, log, cache, or persist the bytes.
7. Run `npx terminay-extension-conformance package.json`, unit tests, and the
   release verifier before packing.
8. Test the packed tarball in a clean Terminay Server, not a workspace import.

The server may stop, restart, retry, or cancel a callback. Make every external
mutation idempotent and every resume operation reconstructible from persisted
redacted provider state. Throw bounded user-safe errors without credentials,
endpoints, provider response bodies, local paths, or stacks.

## Provider lifecycle

`activate` declares providers and performs no external mutation. Profiles store
non-secret configuration and opaque host-owned secret bindings. Creating an
environment returns either `ready` or a resumable `pending` operation. `getStatus`
must be read-only. Actions, updates, and deletes return a revised state and may
also be resumable. `invokeService` is optional and is only for the documented
terminal/filesystem capability DTOs accepted by that provider; it is not a
generic command surface.

Deactivation stops admissions and releases resources. It must not delete remote
machines, files, profiles, credentials, or environments.

## Conformance workflow

The CLI verifies the closed manifest, package identity, and exported entrypoint:

```sh
npm run build
npx terminay-extension-conformance package.json
node ./node_modules/@terminay/extension-api/scripts/verify-release.mjs . --output ./release-evidence
npm pack --ignore-scripts
```

Install the resulting exact tarball into a disposable server data root for the
final smoke test. Installation from a folder, Git URL, or tarball is not a
supported end-user install path; this local step only verifies what will be
published.
