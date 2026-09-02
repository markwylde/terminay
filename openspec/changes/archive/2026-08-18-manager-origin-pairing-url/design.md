## Context

See proposal.md. The advertised pairing URL is the only part of the remote
access journey a user copies and pastes by hand, so it must land on the
installable manager rather than on a session subdomain, without moving the
WebRTC peer or the enrollment authority.

## Goals / Non-Goals

Goals:
- Pasting a hosted pairing link into a browser lands on `app.terminay.com`.
- Desktop pairs against the session origin the link identifies, not the manager.
- The pairing secret never leaves the URL fragment.

Non-Goals:
- Moving signaling, ICE, or enrollment to the manager origin.
- Changing the standalone (non-hosted) fragment pairing URL's HTTPS enroll path.

## Decisions

- **Session id in the query, secret in the fragment.** The link carries
  `?s=<session-id>` and an optional `hostName`, with the secret after `#`, so
  the secret is never sent to the manager's server, never appears in query
  strings, logs, or saved profiles, and the session origin is reconstructed
  from `s` plus the manager's parent domain and port rather than being taken
  from the link's own origin.
- **The manager is never the server.** Desktop Add connection reconstructs the
  session origin and enrolls there; it never enrolls against
  `app.terminay.com`. `hostName` is used only as a default profile label.
- **Legacy links still work.** `/v1/` session pairing URLs remain accepted, so
  previously issued links do not break.
- **Transport stays where it was.** Signaling, ICE, and session origins remain
  on the session subdomain; only the advertised entry point moves.

## Risks / Trade-offs

- Reconstructing the session origin from the manager's parent domain couples
  the link format to the hosted domain layout; that is accepted because the
  format is only used for hosted pairing, and standalone fragment pairing URLs
  keep their existing HTTPS enroll path.
- A `hostName` in the query is user-visible metadata; it is treated only as a
  default label and carries no authority.
