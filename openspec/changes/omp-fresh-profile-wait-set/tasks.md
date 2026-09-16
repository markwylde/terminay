## 1. Name the nearest existing ancestor

- [x] 1.1 Add `awaitedHomeAncestor` and `awaitedEnvironmentAncestor` to `packages/extension-api/src/agent.ts`, walking from the directory up to the home directory or the variable's root. Verified by `npm test` in `packages/extension-api`: the directory itself, a partial parent, the root alone, and no home at all.
- [x] 1.2 In `extensions/agent-omp/src/ompAgent.ts`, name an existing sessions root as a tree and a missing one by its nearest ancestor, shallowly; name the breadcrumb directory by its nearest ancestor. Verified by `npm test` in `extensions/agent-omp`: a configured-but-unrun profile names its agent directory shallowly, and a home with no omp directory names the home shallowly.

## 2. Checks

- [x] 2.1 Run `openspec validate --all` and `npm run lint`. Verified by both reporting clean.
- [ ] 2.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped`. Verified by the status listing itself.
