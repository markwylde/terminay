## Why

Someone with more than one forge account connected — say a self-hosted Gitea
for work and GitHub for open source — sees every account's pull requests and
issues merged into one list on Home, with no way to look at just one of them.
Gitea issue #542 asks to filter the Pull Requests and Issues lists by account.

Today the host forge service already lists one stream per account and merges
them, but a list request can only narrow by repository, so the client cannot
ask for one account's items, and filtering the merged page in the renderer would
leave pages short and counts wrong.

## What Changes

- Home › Pull Requests and Home › Issues each gain an **Account** control in the
  toolbar with **All accounts** (the default) and one entry per signed-in
  account that serves that section, labelled with the account's login, host, and
  forge. The control appears only when two or more such accounts exist.
- Choosing an account narrows the list to that account's items; the choice is
  remembered on the device per section, beside the scope, state, and grouping
  that are already remembered.
- A remembered account that is no longer connected is shown as All accounts
  until it returns or the user picks another.
- When a project tab sends the user to Home focused on a repository, the
  section shows that repository across all accounts until the focus is cleared
  or the user picks an account; the remembered account is unchanged.
- Choosing an account closes a detail preview of another account's item.
- When an account filter leaves the list empty, the empty state names the
  account and offers **Show all accounts**.
- The forge list request accepts an optional `accounts` set of
  `{ sourceId, origin }` pairs. The host forge service opens streams only for
  the matching accounts, so paging, totals, and source outcomes describe the
  narrowed list. The narrowing can only remove accounts; it never widens what a
  caller can see, and a malformed set is refused rather than ignored.
- This change archives after `forge-pull-requests-and-issues`, whose
  capabilities it extends.

Decisions made without the user (issue #542 has no body):
- An account is one forge source's login on one origin — the unit Settings ›
  Extensions already lists and the unit the service already streams.
- Scope is Home only. A project's Git tab is already narrowed to the project's
  claimed repositories, which pins the origin, so an account filter adds
  nothing there.
- Home's sidebar badge counts keep counting every account.

## Capabilities

### New Capabilities

- `forge-sources`: the forge list request's account narrowing (the capability is
  introduced by the in-flight `forge-pull-requests-and-issues` change and is not
  yet in `openspec/specs/`).

### Modified Capabilities

- `pull-requests-and-issues`: Home's Pull Requests and Issues sections filter by
  account and remember the choice per section.

## Impact

- `packages/server-core/src/forge/service.ts` and `adapter.ts`: accept, check,
  and apply `accounts` on list requests; include it in the list cache key.
- `packages/client-core/src/forgeClient.ts`: `ForgeClientListRequest.accounts`.
- `src/forge/forgeModel.ts`, `ForgeHome.tsx`, `ForgeViews.tsx`, `forge.css`:
  the remembered preference, the account options, the toolbar control, and the
  filtered empty state.
- Unit tests beside each, and a Docker-isolated Playwright spec with a fake
  forge source that has two accounts.
- No new dependencies, no settings, and no stored server state.
