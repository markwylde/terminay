## Why

A change to the hosted connection manager (`app.terminay.com`) can only be tested on a real phone after it reaches production. iOS PWA layout bugs need a per-pull-request preview manager before release, and a Terminay server cannot pair with one. The server takes a single "hosted domain" and always derives the manager as `app.<domain>` and each session as `<session>.<domain>`. A preview at `app-pr123.dev.terminay.com` therefore has no domain that produces it, and the parsers assume `.terminay.com` by name.

## What Changes

- Replace the single hosted-domain setting with two explicit hosted endpoints:
  - **App Server**: the exact connection-manager origin. Default `https://app.terminay.com`.
  - **Session Server**: a session-origin template containing exactly one `<session>` placeholder in its leftmost DNS label. Default `https://<session>.terminay.com`.
- A developer can point a server at a preview manager, for example App Server `https://app-pr123.dev.terminay.com` and Session Server `https://<session>-pr123.dev.terminay.com`. Every preview host then sits one label under `dev.terminay.com`, so one wildcard DNS record and one wildcard certificate cover all previews.
- Every session keeps its own origin, distinct from the manager and from every other session. Servers are untrusted, so this browser isolation is preserved: the template must put `<session>` in the leftmost label, and the App Server must never match the Session Server template.
- Pairing-link formatting and parsing, session-id extraction, the manager-origin and session-origin derivation, and hosted/session classification use the configured endpoints. Nothing assumes `app.` or `.terminay.com`.
- Desktop **Settings › Remote Access** shows **App Server** and **Session Server** in place of **WebRTC hosted domain**.
- **BREAKING** (standalone server): `--hosted-domain` / `TERMINAY_HOSTED_DOMAIN` are replaced by `--app-server` / `TERMINAY_APP_SERVER` and `--session-server` / `TERMINAY_SESSION_SERVER`. The daemon installer writes the new variables.
- A server whose configured endpoints change mints a new stable session origin from the new template, rather than advertising an origin the configured relay does not serve.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `remote-access`: hosted pairing links and stable session origins come from the configured App Server and Session Server, not from fixed `app.terminay.com` / `<session>.terminay.com`. Adds the isolation and validation rules for the two endpoints and the Desktop settings.
- `server-runtime-and-protocol`: the standalone foreground entry takes `--app-server` and `--session-server` instead of `--hosted-domain`.
- `daemon-cli`: the installer's environment file records the App Server and Session Server instead of the hosted domain.

## Impact

- `packages/protocol`: `managerOrigins.ts` and `hostedPairingUrl.ts` gain a hosted-endpoints value with production defaults and template-aware session-id extraction. The `app.` and `.terminay.com` derivations are removed.
- `apps/terminay-server`: `cliOptions.ts`, `cli.ts` (manager origin, pairing-format classification), `remote/sessionOrigin.ts`, `remote/hostedPairingSecrets.ts`, `remote/directSessionId.ts`, `remote/publicPairingUrl.ts`, `remote/hostedPairingHost.ts`.
- `apps/terminay-cli`: install arguments, layout and systemd environment file.
- `electron/remote/webrtc.ts`, `electron/remote/service.ts`, `electron/remote/desktopPairing.ts`: embedded-server pairing.
- `src/terminalSettings.ts`, `packages/server-core/src/settings/defaults.ts`: settings model, migration and Settings UI fields.
- `apps/terminay-web`: manager-origin checks.
- Out of scope: the `terminay.com` repository (the hosted manager and relay) must accept the same two values from its own environment, and the preview-environment workflow and infrastructure live there and in `infrastructure`. Those are separate pull requests that depend on this one.
