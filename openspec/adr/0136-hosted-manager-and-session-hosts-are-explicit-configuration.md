# ADR-0136: Hosted manager and session hosts are explicit configuration

Status: accepted
Date: 2026-11-18

## Context

ADR-0005 and ADR-0012 isolate untrusted server code from the connection manager. The manager runs at `app.terminay.com`, and every server's session runs at its own `<session-id>.terminay.com` origin. Every component derived both hosts from one "hosted domain" by convention: the manager was `app.` plus the domain, and a session was its id plus the domain. Parsers recognised `app.*` and `*.terminay.com` by name.

That convention cannot address a per-pull-request preview of the hosted manager. Previews use flat names under one wildcard, such as `app-pr123.dev.terminay.com` with sessions at `<id>-pr123.dev.terminay.com`, so that one DNS record and one certificate cover every pull request. Without previews, manager changes reach a phone only in production.

## Decision

1. **Two values, no derivation.** Hosted access is addressed by an **App Server** (the exact manager origin) and a **Session Server** (an origin template containing `<session>` exactly once, in its leftmost label). The defaults are `https://app.terminay.com` and `https://<session>.terminay.com`. No component derives one from the other or assumes `terminay.com`.
2. **One implementation.** `@terminay/protocol` owns formatting, parsing, validation and session-id matching for the pair. Servers, Desktop, the web host and the hosted manager use it rather than their own string rules.
3. **Isolation is enforced by validation.** A pair is valid only if:
   - `<session>` sits in the leftmost label.
   - The App Server never matches the template.
   - Distinct ids yield distinct origins.
   - Both use HTTPS, except on loopback hosts.
   - Neither carries credentials, a path, a query or a fragment.

   Invalid pairs are never used to advertise or accept a link.
4. **Clients trust only their own configuration.** A pairing link names its manager origin and session id, never a session template. A client accepts a manager link only from its configured App Server and builds the session origin from its configured Session Server.

## Consequences

- Production behaviour and hosts are unchanged. ADR-0005 and ADR-0012 stand: their hosts become the defaults of this configuration.
- Developers can point a server at any preview manager by changing two settings, and the preview stack needs only one wildcard DNS record and certificate.
- A server and a client configured with different endpoints cannot pair. This is intended.
- Standalone `--hosted-domain` / `TERMINAY_HOSTED_DOMAIN` is replaced by `--app-server` and `--session-server`.
