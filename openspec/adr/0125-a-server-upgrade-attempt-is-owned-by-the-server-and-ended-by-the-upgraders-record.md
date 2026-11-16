# ADR-0125: A server upgrade attempt is owned by the server and ended by the upgrader's record

Status: accepted
Date: 2026-11-16

## Context

ADR-0062 has a server hand its upgrade to the upgrader its release ships, which replaces the server that asked. A system-scope server reaches root only through a helper that ignores the request file's contents. The server and its clients then learned how an upgrade ended by inference: an outcome record written only by runs that moved the release, matched to the attempt by time, and endings judged by comparing version strings.

On 16 November 2026 a phone's upgrade card stayed on **Installing** indefinitely. The restarted server had read its stale install record and offered the Canary build it was already running: rolling builds share one version string. A second request ran the helper, which found nothing to do and recorded nothing, so the attempt could end only at a 30-minute deadline. Each earlier fix had added inference in one place. The fault was the lack of an attempt identity and of a record for every run.

## Decision

1. **The server owns each attempt.** An accepted start creates an attempt with a server-chosen id, the requesting device's request id, its mode, its start time, an absolute expiry, and the release it starts from, by version and revision. The server persists the attempt in its data root before the handover and keeps it, with its ending, until the next attempt replaces it. The server running after a restart takes the attempt up and reports it. The attempt never crosses into the root helper, which stays content-blind.
2. **Every mutating upgrader run records itself, one at a time.** `daemon upgrade`, in every mode, holds an install-wide lock, chooses a run id, writes a start record before it resolves the channel, and writes exactly one ending under that run id: succeeded, rolled back, unchanged, or failed before anything changed. An ending is written only once it is final.
3. **The bound run's record ends the attempt.** While an attempt is pending, the server watches the record (ADR-0028). The first run that starts after the attempt is bound to it, and only that run's ending ends it. Absolute one-shot deadlines, persisted with the attempt, bound every attempt across restarts. Without the bound run's success, the server never reports success.
4. **Revision is a build's identity.** A server never offers the revision it runs, and offers nothing from an install record that names another revision. Version strings are for people.
5. **Clients render, the server decides.** Attempts are published on their own capability, query, and event, so released clients keep reading the unchanged status. A client follows an attempt by the request id it sent and the attempt id it reads, and ends it on that attempt's ending or on a connection-level ending. Clients do not judge an ending from versions or times on a server that publishes attempts.

## Consequences

- An upgrade that finds nothing to do, or fails before it changes anything, ends within seconds rather than at a deadline.
- The server's status describes every stage, so every client shows the same steps.
- The install lock plus run ids are what make a content-blind helper sufficient. Carrying the attempt id into the root helper would need a new ADR.
- A release that predates this decision performs the upgrade away from itself under the old rules. Clients keep those rules only for servers that do not advertise attempts.
- ADR-0062, ADR-0028, and ADR-0117 stand unchanged. ADR-0028 supersedes ADR-0022, whose watch-first rule it carries.
