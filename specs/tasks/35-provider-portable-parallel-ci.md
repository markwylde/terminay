# Pull-request confidence gate

## Contract

- [x] Specify one build, lint, and fast-test job.
- [x] Specify five independent Docker E2E shards.
- [x] Keep release, image, and native architecture evidence out of PR CI.
- [x] Specify stale-run cancellation and runner-capacity boundaries.

## Workflow implementation

- [x] Replace the accumulated PR matrix with one fast gate.
- [x] Split the Electron suite into five independent Docker shards.
- [x] Remove pull-request and ordinary-main triggers from image workflows.
- [x] Keep native arm64 work in the manual release path.

## Verification and integration

- [x] Update workflow contract tests.
- [x] Run the affected local workflow contract tests.
- [ ] Confirm Gitea creates exactly six eligible PR jobs.
- [ ] Keep the Gitea pull request and post-merge main checks green.
