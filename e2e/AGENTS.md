# AGENTS — end-to-end tests

E2E tests describe the desktop product contract.

- Test user-observable workflows through the app helpers; do not reach into
  implementation state unless a test-only API is the only stable seam.
- Keep tests self-contained with workspace fixtures and clean up spawned
  terminals/windows.
- Add or update coverage when a feature spec's acceptance behaviour changes.

