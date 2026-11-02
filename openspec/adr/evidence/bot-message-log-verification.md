# Bot message log verification — 2026-11-02

## Implemented contract

One durable bot communication log, fresh ACP executions per user post, explicit MCP posting, bounded history/search/detail/event reads, durable raster attachments, execution inboxes and cancellation/replacement. Normal admission is four work executions plus one user-message coordination execution, with twenty waiting items. Replacement reserves freed admission until cancellation completes. Shared shell/desktop ownership is separate from execution admission.

The private runtime exposes only bot communication/coordination. Its Python stdio adapter reaches a private per-execution Unix socket, multiplexed through the existing authenticated engine exec stream. It does not compose the workspace MCP registry or expose a host port. Capability tokens are execution-scoped and redacted. Same-bot executions share a container/uid and are cooperative peers, rather than isolated hostile principals.

The tool-shell prefix and Bash's execution-scoped `BASH_ENV` guard check shared-work ownership before ordinary shell commands and remove credential/capability variables before the requested command. Explicit alternate shells and provider file tools remain within the same-bot cooperative trust boundary; this is not a sandbox against malicious sibling code. Codex environment inheritance is described in [official configuration documentation](https://learn.chatgpt.com/docs/config-file/config-advanced).

## Automated verification

- Shared builds and all 27 workspace typecheck tasks passed; renderer TypeScript passed.
- Server bot/client test run: 180 passed, five existing optional integration skips. Further targeted bridge/client, reserved-admission and clear/inbox race tests passed after final changes.
- Chromium UI suite: 37 passed, including paginated older history, platform menu positioning in transformed panes, message mutations, separate execution diagnostics, sending during work and inline images.
- Docker-isolated Electron bot E2E: seven checks passed on the first run; the sign-in test exposed a refresh race erasing posting errors. After correction, its isolated Docker rerun passed. The complete final Docker rerun passed all eight tests.
- Lint passed with existing repository warnings (61); no lint errors.
- `openspec validate --all`: 102 passed, zero failed. Including archive reports four existing archived changes with incomplete task checklists: agent-provider-status-conformance, notifications-icon-and-project-dot, macros-script-editor and github-worktree-status. Those unrelated historical artifacts were not altered.

## Real pinned adapter and development app

Used installed `@agentclientprotocol/codex-acp@2.5.0`, model `gpt-6.1-sol`, the existing development bot's device sign-in and the pinned local Podman socket. No real Terminay profile or host login was reset.

- Fresh execution `b57b8fb9b983dcd71f9553da` explicitly called chat posting and persisted “Explicit MCP posting verified”. Raw provider output did not become a message.
- BBC News execution `1019df96a6a70dd950ff84ee` was active when correction execution `0138ca3cba7b9cb169d43a37` started. The model chose `sessions_replace`; the first execution stopped and recorded `supersededBy` pointing to the correction. The correction navigated to BBC Sport and inspected fresh screenshots. The first isolated screenshot probe used an incorrect server identity and was correctly refused by container ownership checks; it was corrected rather than weakening those checks.
- Fresh screenshot execution `fd6d826e77049481706a1794` called `work_acquire`, took/read a screenshot and posted one durable attachment. Reopening the server message store after process exit returned PNG attachment `0e68e9c19e2a2700e8108b12`, 469,966 bytes.
- The real container rejected a Bash command before acquiring work and allowed the same command after acquisition.
- Rebuilt and launched the canonical dev app. Sending a screenshot request through its UI created fresh execution `af649289a85f354c27ac01de`; it explicitly posted progress and a final durable screenshot message. Accessibility inspection confirmed the final image `browser-screenshot.png`, completed execution and idle bot. Existing communication was imported once and original execution diagnostics retained.
- Built the current bot image locally and recreated the development container from it, preserving its home and device login. The new durable screenshot attachment remained in server-owned storage after recreation. Chromium remains request-driven after its single startup launch; no browser restart monitor was added.

## Delivery

All work remains on `feat/bots-container-socket` in the existing PR #479. CI results must be read for the final pushed head before marking the PR ready.

## Chat bottom alignment — 2026-11-02 follow-up

The owner reported Chat stopping above the bottom because screenshots load after its initial scroll. Chat now synchronously pins on entry and observes transcript/viewport size changes, following delayed image layout only while pinned. Manual history scrolling disables following; returning to Chat restores it. Scroll behaviour is explicitly non-animated. Delayed large-PNG, mode/visibility re-entry and manual-scroll regressions passed; the full Chromium bot UI suite passed 39 checks. Renderer TypeScript and lint passed.

### Correction after real app reproduction

The initial resize-observer patch missed browser-generated scroll events: they were interpreted as manual scrolling and disabled following before the image finished loading. Reproduced by switching Configure → Chat in the development app. DevTools measured `scrollTop=548.5`, `clientHeight=610`, `scrollHeight=1494` (335.5 px short). Following is now disabled by explicit wheel/touch/scrollbar/keyboard gestures rather than arbitrary scroll events. After the same real-app switch with the image loaded: `scrollTop=884`, `clientHeight=610`, `scrollHeight=1494`, bottom gap zero. The user-facing Sessions wording was restored. The full Chromium bot UI suite passed 40 tests, including a new layout-generated-scroll regression and real wheel scrolling.


## Agent-owned trigger management (2026-11-02)

The scoped runtime now advertises triggers_list/get/create/update/delete/enable/preview/run. Each call derives bot ownership from its live execution, and mutations use the shared BotTriggers service with an observed server revision. Lists omit prompts, default to 10, cap at 25 and fit within 8 KiB; prompt detail reuses authenticated UTF-8-safe text slices, preserving genuine replacement characters. Changed list revisions, prompt changes, cross-bot cursors and revoked callers are refused. Trigger configuration changes emit bounded events, including UI edits and once-trigger disabling; scheduler evaluation alone emits no configuration event.

Four new service/runtime integration tests cover CRUD, persistence, no-work-lease access, escaped Unicode prompt continuation, pagination, search/cursor scope, stale and concurrent creates, duplicate Run now refusal, cross-bot and revoked calls, validation/count limits, schedule preview/time zone, independent Run now execution, actual scheduler firing and configuration events. The real Python MCP bridge test verifies discovery of all eight trigger tools.

Verification: the serialized bot server/client suite passes 187 tests with five optional skips (192 total). Five targeted UTF-8/trigger tests and the final concurrent-create check pass. Renderer TypeScript and all 27 workspace typechecks pass; targeted lint has no errors or warnings (one existing informational suggestion). Active OpenSpec validation passes all 102 items. An initial parallel server test run was terminated with exit 137; the serialized rerun passed.

Real dev verification used the installed Codex ACP provider in session 07941be58eca72ec6d0e0d12. It listed zero triggers, previewed weekdays at 09:00 in the server time zone, created a disabled hourly smoke-test trigger, read and renamed it, enabled then disabled it, deleted it, and listed zero triggers again at revision 8. Every MCP call completed, the provider session completed, and its explicit chat_post confirmation appeared in the app. It used no shell tools, did not run the trigger and left no test trigger. Existing bot home, credentials, messages and container were retained.
