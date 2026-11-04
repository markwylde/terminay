## 1. Server

- [x] 1.1 Let another agent's update take a terminal whose holder is `done` or `idle`, in `applyProviderActivity`

## 2. Verification

- [x] 2.1 Reducer test: a second chat is fenced while the first works, heard once it has finished, and a different harness takes an idle terminal
- [x] 2.2 Pull request checks green
- [ ] 2.3 Confirmed on Desktop: a second chat in a terminal raises the Dock badge and a banner when it finishes

### Audit evidence — 2026-11-04

Read back every head status on [PR #387](https://git.i.wylde.net/markwylde/terminay/pulls/387), `7dea1dbbd080985879e2d0a424aaab08f4609bf4`: all 26 are success or skipped. Separate unchecked manual or external-repository checks remain open.
