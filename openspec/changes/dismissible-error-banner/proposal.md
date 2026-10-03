## Why

A project's error banner cannot be closed. Once an operation fails, the notice
stays across the top of the workspace until some later operation happens to
clear it, so a failure the user has already read — a Git scope that is no longer
available, a provider that rejected a request — keeps taking space and attention
with nothing the user can do about it.

## What Changes

- The project error banner carries a dismiss control. Activating it removes the
  banner, whatever operation raised the notice.
- A dismissed notice stays gone until another failure is reported.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: gains a requirement that a project's error
  banner is dismissible by the user.

## Impact

- `src/App.tsx` — dismiss control on the banner, and a handler that clears the
  notice together with the feature-failure record behind it.
- `src/App.css` — banner layout and dismiss control style.
- `e2e/ai-tab-metadata.spec.ts` — dismissal covered on an existing failure path.
