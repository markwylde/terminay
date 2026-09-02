## Why

The hosted browser installed a server UI by requesting a manifest and then
requesting, base64-decoding, hashing, validating, and caching every file
independently. The manager duplicated knowledge of Terminay filenames such as
`remote.html` and `server.html`, so a legitimate rename of a server entry made
the manager reject an authenticated bundle as an unsafe path. The hosted
compatibility workflow also checked out and built the private Terminay source
repository, making source-host credentials and a pinned cross-repository build
prerequisites for an otherwise generic manager pull request.

## What Changes

- Replace manifest enumeration plus per-file `asset:get` with one versioned
  `asset:get-bundle` request and a binary chunk stream, with defined framing,
  ordering, backpressure, cancellation, timeout, compressed-byte limit, and
  typed failures. Binary bodies are never base64-wrapped in JSON.
- Make the response a gzip-compressed tar archive whose root holds exactly one
  `terminay-bundle.json` carrying `archiveFormatVersion`, `entryPath`,
  `bundleId`, and `applicationProtocolVersion` — and no per-asset names or
  hashes.
- Let the server prepare the archive once per built bundle and reuse its
  immutable bytes for all clients; archive creation and delivery belong to the
  server bundle host.
- Make the browser host a generic archive installer: stream, decompress,
  unpack, and stage into Cache Storage under `/remote-app/<bundle-id>/`, then
  activate atomically and launch the metadata-declared relative entry.
- **BREAKING**: remove the WebRTC asset manifest, descriptor, response-hash,
  per-file request, and filename-allowlist protocol from Terminay and
  `terminay.com`. Ordinary direct-HTTPS static bundle routes are unaffected.
- Replace `terminay.com` CI's checkout and build of the private Terminay
  repository with an in-repository fixture server, and remove Terminay source
  pins, deploy keys, and build steps from that workflow.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `server-runtime-and-protocol`: bundle transfer becomes one versioned binary
  archive stream owned by the server bundle host.
- `connections-and-client-hosts`: the browser host becomes a generic archive
  installer with containment and denial-of-service limits only, and no
  knowledge of Terminay build layout.

## Impact

- Terminay Server: archive preparation, caching, and the authenticated
  asset-lane implementation.
- `terminay.com`: archive installer, Cache Storage staging, removal of
  filename allowlists and per-file transfer.
- CI: an in-repository archive fixture on the manager side and a source-owned
  integration proof on the Terminay side.
- A recorded compression and transfer benchmark
  (`npm run benchmark:server-ui-archive`).
