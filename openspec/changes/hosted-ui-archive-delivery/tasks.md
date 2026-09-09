## 1. The archive carries a servable workspace UI

- [x] 1.1 Default `--ui-bundle` to `dist-web` in `scripts/build-standalone-server-artifact.mjs` and assert the staged tree contains the hosted archive entry, failing with the entry named; verified by a unit test staging a tree with and without `server.html`
- [x] 1.2 Assert the same entry in `scripts/probe-standalone-server-archive.mjs`, so an archive that cannot serve a workspace fails the probe the release already runs; verified by a test probing a fixture archive whose `ui/` lacks the entry
- [x] 1.3 Build the server-served UI bundle in the release archive job before staging it, and assert the job does so; verified by `scripts/release-artifact-build-contract.test.mjs` extended with that assertion

## 2. The server is told where its UI is

- [x] 2.1 Write `TERMINAY_UI_RENDERER_DIRECTORY` beside `TERMINAY_UI_BUNDLE` in the CLI's environment template; verified by the golden-file environment test asserting both names and one value
- [x] 2.2 Add the renderer directory on `daemon upgrade` when an existing environment lacks it, reusing the single-variable edit; verified by a test upgrading a server whose environment carries only the local UI bundle
- [x] 2.3 Assert the two variables are the pair the server reads, so a future rename of either is caught here rather than by a paired device; verified by a test reading both names out of the server source

## 3. An exposed server without a UI says so

- [x] 3.1 Fail startup when a server is exposed and no renderer directory is configured, naming the variable to set, rather than serving the placeholder archive; verified by a test starting an exposed server with no renderer directory and asserting the failure names the variable
- [x] 3.2 Keep the placeholder for a server that is not exposed, so a protocol-only deployment is unaffected; verified by a test asserting an unexposed server starts without a renderer directory

## 4. Proving it end to end

- [x] 4.1 Extend the systemd container smoke to assert the installed environment names the renderer directory and that the archive's `ui/` carries the hosted entry; verified by the smoke passing under `TERMINAY_RUN_DAEMON_SMOKE=1`
- [x] 4.2 Run `openspec validate --all` and `npm run test:ci`; verified by both passing in CI
