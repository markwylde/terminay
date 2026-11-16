## 1. Server: narrow list requests to accounts

- [x] 1.1 Add `forgeQueryAccounts: 16` to `EXTENSION_LIMITS` in `packages/extension-api/src/constants.ts`. Verified by `timeout 600 npx turbo run build --filter=@terminay/server-core...` succeeding.
- [x] 1.2 In `packages/server-core/src/forge/service.ts`: add `accounts?` to `ForgeListRequest`; refuse a present but malformed or oversized set in `checkListRequest`; in `openStreams` skip unnamed sources before account discovery and unnamed origins per source; report `noAccounts: false` when a set is present; add `accounts` to `listKey`. Verified by 1.4.
- [x] 1.3 In `packages/server-core/src/forge/adapter.ts`, copy `accounts` whenever the body has the key, whatever its value. Verified by 1.4's adapter cases.
- [x] 1.4 Extend `packages/server-core/test/forge-service.test.mjs`: a set naming the Gitea account asks only Gitea for accounts and items (calls log), returns only its items and outcomes; omitted set asks both; a set naming both asks both; empty set and unknown origin return an empty list with `noAccounts: false` and no item query; a failing excluded source's discovery is not reported; same source with two origins narrows to one; `openProjects` settings still restrict a named account; a cursor from another account set is refused; through `ServerForgeAdapter`, `accounts: null`, an object, a non-HTTPS origin, and 17 entries are refused as invalid. Verified by `timeout 900 npx turbo run build --filter=@terminay/server-core...` then `cd packages/server-core && timeout 600 npm run test:ci` passing.

## 2. Client contract

- [x] 2.1 Add `accounts?` to `ForgeClientListRequest` in `packages/client-core/src/forgeClient.ts`. Verified by `timeout 600 npx turbo run build --filter=@terminay/client-core...` and `timeout 600 npm run typecheck` passing.

## 3. Renderer: model

- [x] 3.1 In `src/forge/forgeModel.ts`: `ForgeAccountRef`, `account` on `ForgeViewPreferences` (default `null`) read only when well formed; `homeAccountOptions(accountsAnswer, sources, kind)` (ready accounts of sources that serve the kind with it on Home; label login · host · forge; stable order); `effectiveAccount(remembered, options | undefined, focused)`; `sameAccount`. Verified by 3.2.
- [x] 3.2 Extend `src/forge/forgeModel.test.ts`: preferences round-trip with and without an account and a malformed stored account reads as null; options exclude rejected accounts and sources without the kind on Home; effective account is null when focused, when options are known and fewer than two, or when the remembered account is absent, and is the remembered one before options are known. Verified by `timeout 600 npm run test:forge-ui` passing.

## 4. Renderer: Home sections

- [x] 4.1 In `src/forge/ForgeHome.tsx`: a `useForgeAccounts` hook (on show and `forge.changed`, newest answer wins); put `accounts: [effective]` on the Home list request when set; choosing an account clears a repository focus and a selection from another account. Verified by 6.1.
- [x] 4.2 In `src/forge/ForgeViews.tsx`: the **Account** `<select>` (All accounts + options, showing All accounts while focused) after the Group control, only with two or more options; the filtered empty state naming the account with **Show all accounts**, after failures in precedence. Style in `forge.css` for both themes and phone width. Verified by 6.1 and its screenshots.
- [x] 4.3 Run `timeout 600 npm run typecheck` and `npx biome check` over the changed files. Verified by both passing.

## 5. Docs

- [x] 5.1 If `docs/` describes the Home Pull Requests or Issues toolbar, add the Account control. Verified by `grep -rn "Needs my review" docs/` and updating any hit.

## 6. End to end

- [x] 6.1 Add `e2e/forge-account-filter.spec.ts`: a fake forge extension with two accounts on two origins and items on each; assert the Account control lists both; choosing one hides the other's items and closes the other account's open preview; the choice is per section and survives reopening Home; the filtered empty state's Show all accounts restores both. Capture screenshots of the control, the filtered list, and the filtered empty state. Verified by `timeout 2400 npm run test:e2e -- e2e/forge-account-filter.spec.ts e2e/forge-pull-requests-and-issues.spec.ts` (Docker-isolated) passing.

## 7. Spec hygiene

- [x] 7.1 Run `openspec validate filter-forge-lists-by-account --strict` and `openspec validate --all`. Verified by this change passing and `--all` reporting no failure that this change introduced (failures in other changes predate it).
- [ ] 7.2 Archive this change only after `forge-pull-requests-and-issues` is archived, so its ADDED requirements land on the forge capability's. Verified at archive time by `openspec validate --all --archived`.
