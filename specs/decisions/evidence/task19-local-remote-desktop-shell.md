# Local authenticated remote-Desktop shared shell

`e2e/desktop-remote-shared-shell.spec.ts` proves the remote-Desktop matrix cell
without depending on hosted infrastructure:

1. launch the production Electron renderer with its embedded Local authority;
2. launch a second standalone Terminay Server on loopback with an isolated
   data root and project root;
3. consume that server's fragment-only, one-time application handoff through
   the real Desktop connection menu;
4. verify the Desktop renderer identifies the new remote authority;
5. reload the production shared terminal route, exercising renderer port
   rehydration; and
6. create a terminal through the remote project's canonical terminal clients.

The test covers a real authenticated remote byte transport, the production
Desktop renderer, shared-route rendering, and a project-scoped server mutation.
It deliberately makes no claim about hosted signaling, deployed services,
TURN, physical devices, or external networks.
