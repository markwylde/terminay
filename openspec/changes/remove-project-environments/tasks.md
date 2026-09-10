## 1. Delete the extensions and their packaging

- [x] 1.1 Delete `extensions/ssh/` and `extensions/puzed/`, remove both from `extensions/builtins.json`, the extension catalogue in `packages/server-core/src/extensions/catalog.ts`, `turbo.json`, `Dockerfile.e2e`, `package.json` workspaces and root scripts, `scripts/stage-built-in-extensions.mjs`, and `scripts/verify-built-in-extension-artifacts.mjs`. Verified by `grep -ri "terminay-plugin-ssh\|terminay-plugin-puzed\|com.terminay.ssh\|com.puzed" --exclude-dir=node_modules --exclude-dir=archive .` returning nothing and the packaging contract tests passing with five built-ins.
- [x] 1.2 Delete the `terminay-target-helper` references and any SSH-only release inputs from the release artifact build and its contract test. Verified by `scripts/release-artifact-build-contract.test.mjs` passing.

## 2. Remove the environment layer from the extension API

- [x] 2.1 Remove `EnvironmentCapability`, `ProjectEnvironmentContribution`, `ProviderRuntime`, `EnvironmentServiceRequest`, `registerProjectEnvironmentProvider`, `dependencyOperations`, `requiredEnvironmentCapabilities`, the declarative provider form and status card types, and `provider.call` and `profile.get` broker operations from `packages/extension-api/src/{types,validation,constants,testing,fixtures,conformance}.ts`; keep the agent provider contribution and the observation broker types. Verified by `packages/extension-api` building and its validation tests rejecting a manifest that declares `projectEnvironments`.
- [x] 2.2 Bump `EXTENSION_API_VERSION` major and update every built-in agent extension's peer range. Verified by conformance tests passing for the five agent packages.
- [x] 2.3 Delete the `environment-capability-missing` outcome and the capability-subsetting fixtures from the agent conformance harness, and drop the matching branches in `extensions/agent-*/src/provider.ts`. Verified by the agent conformance suite passing with every observation capability present.

## 3. Remove environment routing from the server

- [x] 3.1 Delete `packages/server-core/src/projectEnvironment/`, `extensions/projectEnvironmentRuntime.ts`, `extensions/remoteFileProtocol.ts`, and `activity/extensionAgentObservationRouter.ts`, folding the local branch of the observation router into `localAgentObservation.ts`. Verified by the package building with no import of the deleted modules.
- [x] 3.2 Remove the router injection and `routeProjectOperationRegistries` from `composition.ts` so operation registries merge directly, and delete the two environment error classes and their mappings from `dispatcher.ts`. Verified by the dispatcher and composition tests passing and by a test that an unknown `git.*` operation returns a validation error rather than routing anywhere.
- [x] 3.3 Remove `RemoteTerminalLaunch` and the remote fork from `terminalService/launchResolver.ts` and `service.ts`, and remove the environment-routed PTY factory from the terminal composition. Verified by the terminal service tests passing with native PTY only.
- [x] 3.4 Remove environment routing from `fileService`, `gitService`, `shellProfiles` discovery, and the MCP bridge so each calls its local implementation. Verified by their unit tests passing and by `grep -rn "projectEnvironment\|environmentRevision\|this-server\|EnvironmentCapability\|THIS_SERVER_ENVIRONMENT_ID" packages apps src electron extensions scripts e2e tests --exclude-dir=node_modules` returning nothing.
- [x] 3.5 Delete the `project-environments.*` and provider-form protocol operations from `packages/server-core/src/extensions/operations.ts` and `packages/protocol`, and delete `packages/client-core/src/projectEnvironments.ts`. Verified by the protocol conformance suite passing.

## 4. Simplify workspace state

- [x] 4.1 Remove `projectEnvironmentId` and `environmentRevision` from `Project` and `projectEnvironmentId` from `TerminalSession` in `packages/server-core/src/workspace.ts`, delete the environment-mismatch validation, and remove `THIS_SERVER_ENVIRONMENT_ID`. Verified by workspace validation tests passing and a test that a project record with an environment field is rejected as unknown.
- [x] 4.2 Increment the persisted workspace state version in `workspaceRepository.ts`; a repository at the previous version is preserved and reported as unreadable per the corrupt-state rule, with no migration code. Verified by a test that opens a previous-version fixture and asserts it is preserved and not loaded.
- [x] 4.3 Remove environment fields from `workspaceHydration.ts`, `workspaceStartup.ts`, the workspace DTOs in `packages/protocol/src/workspace.ts`, and `electron/projectEnvironmentPersistence.ts` (deleted). Verified by startup restore tests passing.

## 5. Simplify the workspace UI

- [x] 5.1 Delete `src/projectEnvironments/`, the environment chooser in the new-project and split-button flows, the immutable-environment display in the project editor, and the Project Environments management window and route on Desktop and web. Verified by the project creation end-to-end test creating a project with only a root on the server.
- [x] 5.2 Remove `environmentRevision` from `src/shared/featureQueryAuthority.ts` and the sidebar feature query keys, and remove environment fields from `src/workspace/projectTabModel.ts`, `useProjectCollection.ts`, `useProjectEditor.ts`, `useFileExplorerController.ts`, `serverWorkspaceReconciliation.ts`, and `src/types/terminay.ts`. Verified by `npm run typecheck` and the `featureQueryAuthority` tests passing.
- [x] 5.3 Remove every "limited on this environment" branch and unavailable-reason string from macros file fields, dictation targeting, AI tab metadata, Git panes, the file explorer, the Performance Log window, and the agent sidebar. Verified by `grep -rn "environment" src --include=*.tsx --include=*.ts` showing only process-environment meanings.
- [x] 5.4 Remove "Project Environments…" from File menus, the Command Bar, and the shared route registry on Desktop and web. Verified by the menu and route contract tests passing.

## 6. Specs, docs, and configuration

- [x] 6.1 Rewrite `docs/product-overview.md` core model, pillars, and architecture boundaries for one server type, and update the `context` block in `openspec/config.yaml` so it no longer names project-environment routing or environment extensions. Verified by both files containing no "project environment" wording.
- [x] 6.2 Update `README.md`, `docs/operations/*`, and `AGENTS.md` where they describe SSH or Puzed projects. Verified by `grep -rni "puzed\|ssh project" README.md docs AGENTS.md` returning nothing.
- [ ] 6.3 Delete the `project-environments`, `ssh-project-environments`, and `puzed-project-environments` spec directories when this change is archived, since every requirement is removed. Verified by `openspec validate --all` passing after archive.
- [ ] 6.4 When syncing or archiving, rewrite the `## Purpose` paragraphs of `extension-platform`, `built-in-extensions`, `agent-status-and-sidebar`, and `file-explorer-and-folder-tabs`, which delta files cannot express, so they name no project environments, SSH, or Puzed. Verified by `grep -n -i "project environment\|ssh\|puzed\|this server" openspec/specs/*/spec.md` returning nothing.

## 7. Close out

- [x] 7.1 Run `openspec validate --all`, `npm run lint`, `npm run typecheck`, `npm run test:ci`, rebuild the packaged app, and confirm the built-in inventory lists five agent extensions and nothing else. Verified by all passing and by reading `built-in-extensions/inventory.v1.json` from the build output.
- [ ] 7.2 Run the Desktop end-to-end suite through `npm run test:e2e`. Verified by the suite passing.
