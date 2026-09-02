## Why

The same shell could start in different directories depending on how the
terminal was created: embedded startup resolved an omitted working directory to
the Desktop home directory, while protocol-created terminals passed an omitted
directory into a PTY service that used `"."` — which in a packaged application
can be `/`. Shell fallback logic also existed in more than one layer, so testing
one creation route did not establish the product contract for the others.

## What Changes

- Add one privileged server-owned launch-resolution component with an immutable
  input/output contract: authorized server, project, and panel identity, explicit
  choices, the settings and workspace revisions used, resolved profile metadata,
  target, argument array, environment, working directory, and dimensions.
- Implement profile precedence (explicit, project, server, System default),
  known-shell startup-mode translation, target revalidation, protected
  environment layering, and bounded failure codes in that one component.
- Implement the working-directory policies and exact fallback semantics,
  distinguishing invalid explicit paths, stale observed panel directories,
  missing project roots, explicit root projects, unsafe implicit roots, and
  legacy-unverified root provenance.
- **BREAKING** Remove production shell candidate lists, `"."`, `process.cwd()`,
  and Electron-home fallbacks from every layer outside the resolver. The PTY
  service now requires a fully resolved launch snapshot and makes no policy
  decisions.
- Route initial workspace seed, new project, new tab, split, open-at-folder,
  Desktop compatibility, browser, local protocol, remote protocol, and
  standalone MCP `open_terminal` creation through the same resolver.
- Enforce authenticated project and session claims on terminal create, list,
  cwd, attach, resume, input, resize, kill, detach, and inactivity operations.
- Extend `terminal.create` with optional profile and active-panel intent while
  refusing ad-hoc launch data; resolve authoritative project and panel records
  server-side and commit a panel only after a successful spawn.
- Persist resolved profile id and revision, safe target summary, working
  directory, and creation time as session metadata, excluding environment values.
- Require an explicit shell for WSL startup, arguments, and environment, keep
  `WSLENV` server-controlled, and treat protected Windows environment names
  case-insensitively.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `shell-profiles-and-terminal-launch`: one canonical launch resolver owns
  profile, argument, environment, and working-directory policy for every
  creation route.

## Impact

The server launch resolver and PTY service, the application protocol's
`terminal.*` operations, the Electron embedded bootstrap, the standalone server
workspace seed, standalone MCP `open_terminal`, and the renderer's terminal
creation paths. Migrated projects with root-like roots are marked
legacy-unverified and require confirmation before their terminals can launch.
