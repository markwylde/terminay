## Why

The browser host had profile, pairing and reconnect, origin-isolation, and
verified-bundle seams, but the deployed composition still needed an explicit
dependency boundary proving it contains no independent full workspace fallback.
Cross-host evidence did not yet prove that all four launch paths execute the
same bundle id, nor cover compatible older, current, and newer host and server
fixtures.

## What Changes

- **BREAKING** Remove any independently versioned full workspace fallback from
  the deployed manager artifact and its normal module graph. The manager becomes
  a thin connection and bundle host.
- Limit the manager to connection profiles, pairing and reconnect, signaling
  and WebRTC bootstrap, bundle verification and installation, isolated session
  launch, and bounded failure and recovery UI.
- Install and execute each server bundle only in its exact isolated session
  origin, passing only the browser host context and the opaque byte endpoint
  across a closed exact-source, exact-origin bridge.
- Make `app.terminay.com` the canonical manager origin, preserving its
  same-origin sanitized profile metadata, and retire `web.terminay.com` to a
  redirect.
- Commit verified bundles atomically and keep the previous complete bundle
  after interruption, invalid hashes, unsafe paths, incompatible requirements,
  or server-identity mismatch.
- Prove Local Desktop, remote Desktop, direct browser, and browser-manager
  sessions launch one server's same verified workspace bundle across the
  supported compatibility window.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `connections-and-client-hosts`: manager scope, verified bundle cache and
  atomic commit, cross-version launch convergence, and origin isolation.

## Impact

The deployed browser artifact and its module graph, bundle verification and
installation, the manager-to-session bridge, manager profile persistence, the
`web.terminay.com` redirect, and the cross-version host/server compatibility
matrix used as a release gate.
