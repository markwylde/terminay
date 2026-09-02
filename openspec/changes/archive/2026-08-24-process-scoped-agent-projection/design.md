## Context

See proposal.md. Three distinct symptoms shared one root cause: agent projection had no
notion of which live Terminay process a snapshot came from, and discovery admission was too
narrow at the foreground and too loose across processes.

## Goals / Non-Goals

Goals:
- The Agents pane reflects only the process that is rendering it.
- Wrapper-launched agents bind as reliably as directly launched ones.
- A user-data root cannot be shared by two live processes.

Non-Goals:
- Loosening the binding proof; process-tree plus writable-journal evidence is still required.

## Decisions

- **Discovery starts broadly, binding stays strict.** Every non-shell foreground, including
  `node` and `bun` wrappers, starts discovery, but binding still requires process-tree plus
  writable-journal proof. Widening the start condition fixes wrapper launches without
  weakening the identity boundary.
- **Wrapper discovery retries the same provider.** Rotating Codex to omp on a `node`
  foreground abandoned the journal that was about to appear, so a wrapper retry stays with
  the provider it was already attempting.
- **Process instance id is the projection boundary.** Each `AgentStatusService` mints an
  ephemeral `processInstanceId` at construction and stamps every snapshot. Protocol snapshots
  carry it, clients pin the first id they observe and ignore later snapshots from a different
  live process until an explicit reset, and renderer subscriptions drop mismatched values.
  This is why a shared `~/.codex` or restored labels can no longer populate another process's
  pane.
- **Topology polling owns rebinding.** When descendant or open-file identity changes the
  observer rebinds; a writer that leaves this PTY tree cancels the observer.
- **The user-data root is exclusive.** An exclusive `.terminay-process.lock` plus the
  Electron single-instance lock fail closed when a second process targets the same root.
- **Admission failures are explainable.** Admission diagnostics carry a bounded host
  `reason`, so a throw surfaces as a described failure rather than an opaque `failed` class.

## Risks / Trade-offs

- Failing closed on a shared user-data root is a hard stop for anyone who deliberately ran
  two processes against one root; the single-instance behaviour makes that state
  unrepresentable rather than subtly broken.
- Pinning the first observed `processInstanceId` means a client must reset to follow a
  genuinely new process, which is the intended trade for never mixing two processes' agents.
