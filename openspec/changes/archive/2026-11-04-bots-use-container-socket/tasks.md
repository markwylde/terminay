## 1. Contract and transport

- [x] 1.1 Reconcile the pending bot-environment contract and record ADR-0092; verify OpenSpec validation and immutable accepted ADRs.
- [x] 1.2 Implement bounded Unix HTTP requests, status classification, version negotiation, streaming and demultiplexing; verify fragmented frames, deadlines, cancellation and errors with a fake socket server.
- [x] 1.3 Implement endpoint discovery, server kind/capabilities, alias deduplication and persistent identity pins; verify minimal PATH, explicit remote refusal, Podman random IDs, changed markers and restart fixtures.

## 2. Bot operations and streams

- [x] 2.1 Route lifecycle, helpers, image archive/build/tag, stats, logs and events through the socket driver; verify request payloads, build stream failures, resource limits and ownership tests.
- [x] 2.2 Move agent and desktop exec streams to the socket and preserve supervision/redaction; verify ACP, credential and desktop regression tests.
- [x] 2.3 Move shell and device sign-in to TTY exec with resize and exit status; verify shell authority, cleanup and sign-in tests.
- [x] 2.4 Separate daemon socket paths from host endpoints and preserve rootless metadata; verify URI normalization and socket mount/group-helper payload tests.
- [x] 2.5 Keep image probe errors inside status, clear stale UI and preserve coalescing; verify missing-image and invalidation-loop regressions.

## 3. Verification and delivery

- [x] 3.0 Start Chromium with the container desktop, independently of agent turns, and export its display to shell/exec processes; verify unprivileged sandboxed startup in init tests and a real booted container.

- [x] 3.1 Replace CLI-dependent engine/composition/E2E fixtures with socket fixtures; verify server bot tests and Docker-isolated bots E2E through npm run test:e2e.
- [x] 3.2 Run project typechecks, builds, lint and OpenSpec validation including archived changes; record results and any environmental limits in verification.md.
- [x] 3.3 Exercise real available Docker and Podman engines, including image build, exec, shell resize and socket sharing; record evidence and unresolved coverage explicitly.
- [x] 3.4 Open one Gitea PR with specs and implementation, read its description back, and verify every PR head status is success or skipped.

## 4. Browser verification and chat control

- [x] 4.1 Ground desktop instructions in Atlas's observe/act/verify approach using only installed tools; verify environment-note tests and a real navigation.
- [x] 4.2 Implement server-owned chat edits/deletions/clearing with ownership, busy and stale-target checks, redaction and fresh provider context; verify composed client mutations, restart persistence and refusal cases.
- [x] 4.3 Add right-click message controls and confirmed Clear chat; verify Chromium UI tests, including assistant/user actions and cancel behavior.
- [x] 4.4 Build and apply the updated desktop image to the development bot while preserving its home/sign-in; verify the browser is present before and after a real agent turn.

## 5. Browser recovery and unfinished tool status

- [x] 5.1 Inspect the failing real transcript, distinguish stale screenshot reads, missing browser and a foreground tool without exit status.
- [x] 5.2 Launch Chromium once at startup and only again on explicit URL requests; verify close remains closed, request dispatch, URL validation and desktop process ownership.
- [x] 5.3 Stop animating tools outside the active turn and label missing outcomes explicitly; verify completed, stopped, failed and running UI cases.
- [x] 5.4 Require screenshot overwrite and request-driven browser navigation in context; build and validate the changes.

- [x] 5.5 Apply the clarified lifecycle: leave a closed browser closed, dispatch explicit URLs outside agent tool groups, and verify both existing-window navigation and launch-after-close in the real development container.

## 6. Screenshot rendering and desktop sizing

- [x] 6.1 Resolve local Markdown images through bounded, authenticated container reads; verify ownership, authority, path, symlink, type and size guards.
- [x] 6.2 Display inline screenshots with loading/error states and blob cleanup; verify actual image rendering and remote-image refusal.
- [x] 6.3 Launch Chromium maximized and verify the live desktop and original screenshot link.

## 7. Bot configuration review

- [x] 7.1 Let Triggers fill the available panel width and verify wide and narrow layouts.
- [x] 7.2 Exclude Terminay infrastructure from bot workloads and their actions; verify real labels and regression tests.
- [x] 7.3 Verify and document current agent CRUD access to memories and triggers without claiming unavailable tools.
