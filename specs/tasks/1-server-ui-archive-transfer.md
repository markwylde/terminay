# Server UI archive transfer

## Goal

Replace the slow, tightly coupled per-file server-UI installation protocol with
one binary `tar.gz` transfer owned by Terminay Server. Keep `terminay.com` a
generic authenticated connection and launch host that does not understand the
Terminay repository, generated filenames, or build layout.

## Governing contracts

- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Remote access](../features/remote-access.md)
- [Server runtime and protocol](../features/server-runtime-and-protocol.md)
- [Server-bundled clients and protocol-blind hosts](../decisions/server-bundled-client-hosts.md)
- [Security threat model](../decisions/security-threat-model.md)

## Current problem

The hosted browser requests a manifest and then requests, base64-decodes,
hashes, validates, and caches every server UI file independently. The manager
duplicates knowledge of allowed Terminay filenames such as `remote.html` and
`server.html`. A legitimate server entry rename therefore caused the manager to
reject an authenticated bundle as an unsafe path.

The hosted compatibility workflow also checks out and builds the private
Terminay source repository. That creates source-host credentials and a pinned
cross-repository build as prerequisites for an otherwise generic manager PR.
It tests repository integration rather than the manager's stable public
contract.

## Required implementation

### 1. Define one archive protocol

- [x] Replace manifest enumeration plus `asset:get` per file with one versioned
  `asset:get-bundle` request and a binary chunk stream.
- [x] Specify transfer framing, ordering, backpressure, cancellation, timeout,
  compressed-byte limit, and typed failure messages. Binary bodies must not be
  base64-wrapped in JSON.
- [x] Make the response a gzip-compressed tar archive containing a required
  root metadata file with the archive-format version and relative UI entry
  path. Metadata must not enumerate or hash every generated asset.
- [x] Permit the Terminay Server to prepare the archive once per built bundle
  and reuse its immutable bytes for all clients. Archive creation and delivery
  belong to the server bundle host, not the Desktop renderer or
  `terminay.com`.

The v1 authenticated WebRTC asset-lane contract is:

1. The host sends JSON `{ "type": "asset:get-bundle", "id": string,
   "archiveFormatVersion": 1 }`.
2. The server sends JSON `asset:bundle-start` with the same id,
   `archiveFormatVersion`, `bundleId`, `compressedBytes`, `chunkBytes`, and
   `chunks`.
3. Each body message is binary, not JSON or base64: four bytes `0x54 0x42 0x01
   0x01` (`TB`, archive protocol v1, chunk kind), followed by a big-endian
   uint32 chunk index and then up to `chunkBytes` gzip bytes. Ordered WebRTC
   delivery requires indexes to start at zero and increase without gaps.
4. The host acknowledges each body with JSON
   `{ "type": "asset:bundle-ack", "id": string, "index": number }`. The
   server sends at most four unacknowledged chunks, applies a 15-second
   acknowledgement timeout, and accepts
   `{ "type": "asset:bundle-cancel", "id": string }`.
5. After the final acknowledgement the server sends JSON
   `asset:bundle-complete`. It reports typed JSON `asset:bundle-error` failures
   with one of `cancelled`, `timeout`, `unavailable`, `invalid-request`, or
   `internal`.

The gzip tar root contains exactly one `terminay-bundle.json` metadata file
with `{ "archiveFormatVersion": 1, "entryPath": string, "bundleId": string,
"applicationProtocolVersion": string }`; it does not list asset names or
hashes. Other tar members are regular server UI files.

### 2. Make the browser host a generic archive installer

- [x] Stream the archive from the authenticated Terminay Server, decompress it
  with browser gzip support, unpack it, and stage its files in Cache Storage
  beneath a generated `/remote-app/<bundle-id>/` namespace.
- [x] Treat all files supplied by the authenticated server as authoritative for
  that exact session subdomain. Remove filename allowlists, Vite-layout
  knowledge, per-file transfer requests, per-file SHA-256 requirements, and
  canonical `remote.html`/`server.html` assumptions.
- [x] Retain only containment and denial-of-service boundaries: reject absolute
  paths, parent traversal, links, duplicate normalized paths, protected
  bootstrap/signaling routes, excessive compressed/expanded bytes, excessive
  entries, and excessive individual entries.
- [x] Atomically activate the archive only after complete extraction and valid
  metadata. Cancellation, disconnect, malformed tar/gzip, unsupported archive
  version, and resource-limit failure retain the previous complete bundle and
  render a precise recovery message.
- [x] Launch the metadata-declared relative entry without interpreting its
  filename. Refresh must recreate the authenticated transport owner before
  executing cached server code; subresources may continue to be served from
  the exact session-origin cache.

### 3. Remove obsolete protocol and repository coupling

- [x] Delete the old WebRTC asset manifest, descriptor, response-hash,
  per-file request, and filename-allowlist protocol from Terminay and
  `terminay.com` once the archive path is deployed. This does not change the
  ordinary direct-HTTPS static bundle routes, which remain normal browser
  resource delivery rather than a WebRTC installation protocol.
- [x] Replace `terminay.com` CI's checkout/build of the private Terminay
  repository with an in-repository fixture server that implements the public
  archive protocol and supplies a small executable archive.
- [x] Remove Terminay source pins, deploy keys/tokens, source-host assumptions,
  and Terminay build/install steps from the `terminay.com` workflow. The
  manager repository must prove its contract without GitHub or Gitea access to
  the Terminay source repository.
- [x] Keep a separate integration proof in the Terminay repository that runs
  the real server archive through a generic hosted-manager fixture. It must not
  make ordinary `terminay.com` pull requests depend on cloning Terminay.

## Acceptance checks

- [x] Terminay's source-owned proof transfers its real UI archive through the
  generic hosted-manager contract, while the manager's browser fixture launches
  the same protocol on Chromium and Firefox. This split is intentional: neither
  repository needs to check out the other to prove its owned boundary.
- [x] A fixture archive with arbitrary nested generated filenames launches
  without a manager change, proving the host does not understand build layout.
- [x] Tests cover fragmented binary delivery, backpressure, cancellation,
  malformed gzip/tar, traversal, links, duplicate paths, every resource limit,
  interrupted staging, atomic replacement, refresh, and reconnect.
- [x] A compression/transfer benchmark records archive size, transferred bytes,
  request count, and install duration against the current per-file protocol;
  the archive path uses one request and no base64 bodies. `npm run
  benchmark:server-ui-archive` records the actual built UI; on 2026-08-15 its
  110-file build transferred 4,629,888 archive wire bytes in one binary request
  with zero base64 bytes, versus 24,765,484 wire bytes in 111 legacy requests.
- [x] The `terminay.com` compatibility workflow passes with network access to
  the Terminay source repositories denied. PR #39 run 7140 passed on
  2026-08-15 using only the in-repository archive fixture.
- [x] Repository searches find no production WebRTC `asset:get-manifest` or
  per-file `asset:get`, generated filename allowlist, Terminay source pin, or
  cross-repository checkout in the hosted manager. Direct-HTTPS static resource
  delivery remains outside this check.

## Definition of done

Terminay Server owns and serves one reusable binary server-UI archive. The
authenticated browser host performs bounded, atomic extraction into the
server's isolated session origin and launches the archive-declared entry
without knowing Terminay filenames or source layout. The old per-file protocol
and the `terminay.com` dependency on a Terminay source checkout are absent, and
the specified browser, failure, recovery, and performance evidence passes.
