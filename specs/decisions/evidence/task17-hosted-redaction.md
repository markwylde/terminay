# Task 17 hosted storage and log redaction evidence

The hosted audit boundary is intentionally metadata-only. `RemoteAuditLog`
creates a fresh event from closed action/reason allowlists and the approved
server, room, peer, and device identifiers; unexpected fields are discarded
before the injected sink is called. The sink therefore receives no pairing,
reconnect, device, PIN, terminal, project, or other application payload.

The standalone-server regression
`apps/terminay-server/test/remote-audit-security.test.mjs` proves both sides of
that boundary:

- direct audit records discard credential and application-data fields;
- a `ServerRemoteExposure` lifecycle writes JSON lines through a hosted-style
  sink, while pairing and reconnect material, device keys, PINs, terminal data,
  and project data remain absent from every persisted line;
- every persisted event contains only the approved metadata keys.

Run the deterministic proof with:

```sh
npm run build --workspace @terminay/server
node --test apps/terminay-server/test/remote-audit-security.test.mjs
```

This proves the local server boundary and its sink contract. It does not claim
that an external hosted provider has been deployed or inspected.
