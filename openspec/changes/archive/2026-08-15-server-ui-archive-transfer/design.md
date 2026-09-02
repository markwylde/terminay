## Context

See proposal.md. Two coupled problems were fixed together: a per-file
installation protocol that was slow and required the manager to understand
Terminay's build layout, and a CI arrangement that made a generic manager
repository depend on cloning a private product repository.

## Goals / Non-Goals

Goals:
- One binary archive transfer owned by Terminay Server.
- `terminay.com` remains a generic authenticated connection and launch host
  that understands neither the Terminay repository nor its generated filenames.
- Neither repository needs to check out the other to prove the boundary it
  owns.

Non-Goals:
- Changing ordinary direct-HTTPS static bundle routes, which remain normal
  browser resource delivery rather than a WebRTC installation protocol.

## Decisions

**One request, one archive, no base64.** The v1 authenticated WebRTC asset-lane
contract is:

1. The host sends JSON `{ "type": "asset:get-bundle", "id": string,
   "archiveFormatVersion": 1 }`.
2. The server replies with JSON `asset:bundle-start` carrying the same id,
   `archiveFormatVersion`, `bundleId`, `compressedBytes`, `chunkBytes`, and
   `chunks`.
3. Each body message is binary: four bytes `0x54 0x42 0x01 0x01` (`TB`, archive
   protocol v1, chunk kind), a big-endian uint32 chunk index, then up to
   `chunkBytes` gzip bytes. Ordered WebRTC delivery requires indexes to start at
   zero and increase without gaps.
4. The host acknowledges each body with
   `{ "type": "asset:bundle-ack", "id": string, "index": number }`. The server
   keeps at most four unacknowledged chunks, applies a 15-second
   acknowledgement timeout, and accepts
   `{ "type": "asset:bundle-cancel", "id": string }`.
5. After the final acknowledgement the server sends `asset:bundle-complete`, and
   reports failures as typed `asset:bundle-error` with one of `cancelled`,
   `timeout`, `unavailable`, `invalid-request`, or `internal`.

**Metadata names an entry; it does not enumerate assets.** The gzip tar root
contains exactly one `terminay-bundle.json` with `archiveFormatVersion`,
`entryPath`, `bundleId`, and `applicationProtocolVersion`. It deliberately does
not list asset names or hashes — that list is precisely the knowledge that made
the manager reject a legitimate server rename.

**The host keeps containment limits, not identity knowledge.** All files
supplied by the authenticated server are authoritative for that exact session
subdomain. Filename allowlists, Vite-layout knowledge, per-file transfer
requests, per-file SHA-256 requirements, and canonical `remote.html` /
`server.html` assumptions are removed. What is retained is only containment and
denial of service: absolute paths, parent traversal, links, duplicate
normalized paths, protected bootstrap and signaling routes, excessive
compressed or expanded bytes, excessive entry counts, and excessive individual
entries.

**Activation is atomic.** The archive activates only after complete extraction
and valid metadata. Cancellation, disconnect, malformed tar or gzip, an
unsupported archive version, and resource-limit failure all retain the previous
complete bundle and render a precise recovery message. Refresh recreates the
authenticated transport owner before executing cached server code; subresources
may still be served from the exact session-origin cache.

**CI proves each side's own boundary.** The manager repository runs an
in-repository fixture server that implements the public archive protocol and
serves a small executable archive, with no Terminay source pin, deploy key, or
checkout. Terminay keeps a separate integration proof that runs its real server
archive through a generic hosted-manager fixture. The split is intentional:
neither repository needs the other's source.

## Risks / Trade-offs

- Treating every server-supplied file as authoritative removes per-file hash
  validation. Accepted: the transport is already authenticated and origin-bound,
  and the retained containment limits address the actual threat — path escape
  and resource exhaustion — rather than file identity.
- A single archive means a partial transfer yields nothing usable. Mitigated by
  atomic activation that retains the previous complete bundle on any failure.

## Migration Plan

The archive path was deployed first, then the old manifest, descriptor,
response-hash, per-file request, and filename-allowlist protocol was deleted
from both Terminay and `terminay.com`. Repository searches confirmed no
production `asset:get-manifest`, per-file `asset:get`, generated filename
allowlist, Terminay source pin, or cross-repository checkout remained in the
hosted manager.

## Recorded evidence

- `npm run benchmark:server-ui-archive` against the actual built UI on
  2026-08-15: a 110-file build transferred 4,629,888 archive wire bytes in one
  binary request with zero base64 bytes, versus 24,765,484 wire bytes across
  111 legacy requests.
- The `terminay.com` compatibility workflow passed with network access to the
  Terminay source repositories denied: PR #39 run 7140 on 2026-08-15, using only
  the in-repository archive fixture.
