# Task 39 browser-manager evidence correction

Date: 2026-08-08

This note corrects the scope of historical browser-manager migration evidence.
It does not rewrite the archived task records, invalidate the sanitizer and
reconnect tests they cite, or claim that the Task 39 recovery work has shipped.
The active recovery checklist is
[Task 39: Browser connection manager drift recovery](../../changes/archive/2026-08-09-browser-connection-manager-drift-recovery/).

## What the historical evidence proves

The archived
[Task 18 connection-menu and web-host task](../../changes/archive/2026-08-01-connection-menu-and-web-host/)
correctly records local evidence for the canonical `web.terminay.com` constant,
safe profile DTOs, exact-origin session navigation, fragment removal from
profile/session URLs, reconnect-vault origin binding, and exact-origin profile
upsert. Its readiness record explicitly reports that public DNS and external
deployment were not verified; see
[Task 18 web-host readiness evidence](task18-web-host-readiness.md).

`WebConnectionHost.migrateLegacyManagerRecord` and the server-side
`sanitizeManagerProfiles` prove a bounded transformation of supplied data:
only validated non-secret profile metadata is accepted, session origins are
preserved, and credential-like fields are excluded. The reconnect fixtures
prove that an independently held exact-session-origin credential is not copied
to manager storage and remains usable in its own authority.

The
[Task 19/20 release and migration audit](task19-20-release-migration-audit.md)
primarily inventories server-bundle, Electron-state, compatibility, release,
and rollback evidence. Its manager-profile references prove sanitization and
session-origin continuity. They do not constitute a browser navigation or
cross-origin storage test.

## What the historical evidence does not prove

The checked Task 18 wording "Define migration/redirect" and the checked Task 19
wording "Move or redirect" must be read as a data-contract/design milestone,
not as evidence that either public origin executed the migration. Before Task
39 there was no evidence for:

- a deployed legacy page at `app.terminay.com` reading the documented legacy
  record and initiating a bounded handoff;
- a one-time cross-origin handoff that avoids query strings, referrers,
  analytics, logs, browser history, pairing fragments, keys, grants, or PINs;
- acknowledgement-gated cleanup at the legacy origin, retry after failed
  import, or the no-profile and blocked-storage recovery paths;
- the canonical manager consuming a handoff once, clearing it from visible
  history, and marking metadata-only profiles as requiring fresh pairing;
- public `app.terminay.com` redirect behavior or a successfully deployed
  `web.terminay.com` manager document and assets; or
- a browser E2E beginning on the legacy origin and ending on the canonical
  origin while leaving session-origin reconnect credentials untouched.

The local Compose restart record,
[Browser reconnect after server-only restart](web-reconnect-server-restart.md),
proves protocol-level reconnect continuity after a server restart. It
explicitly does not prove visual browser automation, cross-origin manager
migration, or public-host routing.

## Superseding evidence requirements

Task 39 is the authority for closing this gap. Executable migration is complete
only when its unit and Docker browser E2E checks prove bounded input, secret
exclusion, one-time consumption, acknowledgement-before-cleanup, retry and
storage-failure behavior, history cleanup, exact-origin upsert, and preservation
of session-origin credentials. Public convergence additionally requires the
deployment verifier and immutable release evidence to identify the selected
image digest and source revision while verifying both public host behaviors.

Until those gates pass, historical sanitizer, readiness, Compose, and
server-migration results must not be described as an executed browser-origin
migration, deployed redirect, or verified public manager release.
