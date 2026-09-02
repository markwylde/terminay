## 1. Define one archive protocol

- [x] 1.1 Replace manifest enumeration plus per-file `asset:get` with one versioned `asset:get-bundle` request and a binary chunk stream, verified by protocol tests
- [x] 1.2 Specify transfer framing, ordering, backpressure, cancellation, timeout, compressed-byte limit, and typed failure messages, and verify binary bodies are never base64-wrapped in JSON
- [x] 1.3 Make the response a gzip-compressed tar archive with a required root metadata file carrying the archive-format version and relative UI entry path, and verify the metadata enumerates no asset names or hashes
- [x] 1.4 Prepare the archive once per built bundle and reuse its immutable bytes for all clients, verified by asserting archive creation belongs to the server bundle host rather than the Desktop renderer or the manager

## 2. Make the browser host a generic archive installer

- [x] 2.1 Stream, decompress, unpack, and stage the archive into Cache Storage beneath a generated `/remote-app/<bundle-id>/` namespace, verified on Chromium and Firefox
- [x] 2.2 Treat all authenticated-server files as authoritative for the exact session subdomain and remove filename allowlists, Vite-layout knowledge, per-file transfer, per-file SHA-256, and canonical `remote.html`/`server.html` assumptions, verified by a fixture archive with arbitrary nested generated filenames launching without a manager change
- [x] 2.3 Retain only containment and denial-of-service boundaries — absolute paths, parent traversal, links, duplicate normalized paths, protected bootstrap/signaling routes, excessive compressed/expanded bytes, excessive entries, and excessive individual entries — verified by a rejection test per limit
- [x] 2.4 Activate atomically only after complete extraction and valid metadata, verified by cancellation, disconnect, malformed tar/gzip, unsupported archive version, and resource-limit failures each retaining the previous complete bundle and rendering a precise recovery message
- [x] 2.5 Launch the metadata-declared relative entry without interpreting its filename and verify refresh recreates the authenticated transport owner before executing cached server code

## 3. Remove obsolete protocol and repository coupling

- [x] 3.1 Delete the old WebRTC asset manifest, descriptor, response-hash, per-file request, and filename-allowlist protocol from Terminay and `terminay.com`, verified by repository searches finding no production `asset:get-manifest` or per-file `asset:get`
- [x] 3.2 Replace `terminay.com` CI's checkout/build of the private Terminay repository with an in-repository fixture server implementing the public archive protocol and serving a small executable archive
- [x] 3.3 Remove Terminay source pins, deploy keys/tokens, source-host assumptions, and Terminay build/install steps from the `terminay.com` workflow, verified by the compatibility workflow passing with network access to the Terminay source repositories denied (PR #39 run 7140, 2026-08-15)
- [x] 3.4 Keep a separate integration proof in the Terminay repository that runs the real server archive through a generic hosted-manager fixture, verified without making ordinary `terminay.com` pull requests depend on cloning Terminay

## 4. Evidence

- [x] 4.1 Cover fragmented binary delivery, backpressure, cancellation, malformed gzip/tar, traversal, links, duplicate paths, every resource limit, interrupted staging, atomic replacement, refresh, and reconnect
- [x] 4.2 Record a compression/transfer benchmark via `npm run benchmark:server-ui-archive`, verified on 2026-08-15: a 110-file build transferred 4,629,888 archive wire bytes in one binary request with zero base64 bytes, versus 24,765,484 wire bytes in 111 legacy requests
