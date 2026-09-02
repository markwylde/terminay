## 1. Contract

- [x] 1.1 Specify one build, lint, and fast-test job, verified by the workflow contract tests.
- [x] 1.2 Specify five independent Docker E2E shards, verified by the workflow contract tests.
- [x] 1.3 Keep release, image, and native architecture evidence out of pull-request CI, verified by the workflow contract tests.
- [x] 1.4 Specify stale-run cancellation and runner-capacity boundaries, verified by the workflow contract tests.

## 2. Workflow implementation

- [x] 2.1 Replace the accumulated pull-request matrix with one fast gate, verified by the resulting workflow definition.
- [x] 2.2 Split the Electron suite into five independent Docker shards, verified by the shard definitions.
- [x] 2.3 Remove pull-request and ordinary-main triggers from image workflows, verified by the trigger definitions.
- [x] 2.4 Keep native arm64 work in the manual release path, verified by the release workflow definition.

## 3. Verification and integration

- [x] 3.1 Update workflow contract tests and verify they assert the new gate.
- [x] 3.2 Run the affected local workflow contract tests and verify they pass.
- [x] 3.3 Confirm Gitea creates exactly six eligible pull-request jobs, verified by PR #50 run 6747 producing one build/lint/unit job plus five independent E2E shards.
- [x] 3.4 Keep the Gitea pull request and post-merge main checks green, verified by PR #50 run 6747 and post-merge main run 6749 completing all six jobs successfully.
