## Context

Under ADR-0091 a device login is written by the agent's own CLI into
`/home/bot`, and Terminay never reads it. The bot's recorded sign-in (`device`)
is set only when the sign-in command succeeds, and cleared only by sign-out.
Nothing reconciles the record with the home, so a removed home volume leaves a
bot that claims to be signed in and fails every session with a 401.

## Goals / Non-Goals

**Goals:**

- A bot whose device login is gone reads as Not signed in, and a message to it
  is refused with the existing Sign-in guidance before the agent starts.

**Non-Goals:**

- Keeping device logins outside the home volume. A refreshed OAuth login
  rotates inside the container, so a host-held copy would go stale.
- Detecting an expired or revoked login. The check is offline and only asks
  whether a login is present.

## Decisions

- **The agent declares the check.** `deviceSignIn.statusCommand` is optional
  and runs the agent's own CLI, so Terminay still never reads the login file
  and stays agent-neutral. Both built-in CLIs exit 0 when a login is present
  and 1 when not, verified in the bot image (`codex login status` prints
  `Not logged in`; `claude auth status` prints `"loggedIn": false`).
- **Run it as `bot` with `HOME=/home/bot`**, after the device config files are
  written, so Codex reads the same `cli_auth_credentials_store = "file"` the
  session uses.
- **Separate a signed-out exit from an engine failure.** The command runs
  under `sh -c '"$@" >/dev/null 2>&1; echo "terminay-status=$?"'`. The CLI's
  output is discarded, and only its exit status comes back. A non-zero status
  signs the bot out. A failed `exec` (engine down, deadline) propagates as a
  session failure and leaves the sign-in as it was.

## Boundaries

- **Credential boundary (ADR-0091).** The check runs inside the bot's own
  container as `bot`. Terminay receives only an exit status, never login
  content.
- **Extension contract.** A new optional manifest field. Agents without it
  behave as before.

## Risks / Trade-offs

- One extra `exec` per session start, offline and bounded at 30 s.
- A future CLI that exits non-zero for some other reason would sign the bot
  out. The user would then sign in again, which is recoverable.
