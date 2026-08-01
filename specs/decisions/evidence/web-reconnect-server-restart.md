# Browser reconnect after server-only restart

Verified locally on 2026-07-27 against the Compose server image.

1. Enrolled a browser device with the one-time pairing credential.
2. Retained only its reconnect handle and browser-side proof material for the
   verification; no pairing URL was used again.
3. Ran `docker compose restart terminay-server` while the `terminay-web`
   container remained running.
4. Waited for the server health check to become healthy.
5. Created a new reconnect challenge, produced its proof, exchanged it for a
   new HTTP ticket, and completed a normal protocol handshake.

Result: the restarted server accepted the persisted reconnect record and the
client resumed without generating or pasting a fresh pairing URL. The check
does not claim visual-browser automation because the configured Computer Use
client was unavailable in this environment.
