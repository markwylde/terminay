## Why

Settings › Remote Access shows a saved server's detail as a bare Status card that says "Saved", and every saved server in the list also says only "Saved". Choosing **Forget** puts a plain-text "Forget this local profile?" straight under the card, touching it, with **Confirm forget** and **Cancel** floating at the far right. The wording calls a remote server a "local profile", and nothing marks the action as destructive. Issue #559 reports this.

## What Changes

- A saved server's detail has titled blocks: **Connection** (status, address) with its actions under it, then a red-outlined **Danger zone** holding **Forget** and, where offered, **Revoke access**, each as a described Settings row.
- Choosing Forget or Revoke turns that row into an inline confirmation inside the danger zone. It names the server ("Forget popos?"), explains the scope as before, and offers **Cancel** first, with focus, then a solid red **Forget server** or **Revoke access**.
- The list and the Status row say whether this window holds a connection to the server. An attached server shows its connection state ("Connected · attached"); one that is not attached says "Saved · not attached". The Desktop host already reports `attached` and the connection state for its remembered profiles; the list now uses them.
- The page-presentation confirmation asks "Forget <name>?" instead of "Forget this local profile?".
- No action changes what it does: rename, forget and revoke call the same host actions after the same confirmation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `connections-and-client-hosts`: the forget and revoke confirmation names the server and is presented as a destructive confirmation; the Remote Access settings saved-server list and detail state whether this window holds the server.

## Impact

- `src/shared/SharedConnectionsRouteBody.tsx`, `src/settings.css`.
- `e2e/settings-remote-access.spec.ts` and its fixture.
- No protocol, host, or privilege-boundary change: the attached flag and state were already part of the sanitized profile summary.
