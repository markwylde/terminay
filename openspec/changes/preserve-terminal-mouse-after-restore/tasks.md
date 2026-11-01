## 1. Portable regression and platform verification

- [x] 1.1 Convert the investigation's SGR-to-default restore reproduction into portable checkpoint/browser regression coverage using repository-resolved dependencies and synthetic output; verify it fails before the fix because restored clicks and wheel reports use the wrong encoding while typing still works.
- [x] 1.2 Verify the pinned Windows node-pty/ConPTY write implementation with a focused high-byte mouse report experiment and record the result; completion requires an exact-byte delivery path consistent with the spec, or an explicit design/spec revision before proceeding with any platform exception.

## 2. Complete checkpoint mouse state

- [x] 2.1 Add a single compatibility helper for canonical xterm mouse tracking and supported encoding state and use it in initial and subsequent checkpoint serialization; verify round trips for disabled/default, SGR, SGR pixel, and supported tracking variants against the pinned packages.
- [x] 2.2 Establish explicit mouse off/default state before checkpoint restoration and re-enable only captured state without changing checkpoint position, geometry, or ordered-tail semantics; verify restoring a tracking-disabled checkpoint over an enabled emulator restores selection/scrollback and that tail mode changes win.

## 3. Deliver mouse bytes through authorized input

- [x] 3.1 Extend ordinary ServerTerminalInputQueue items to accept copied Uint8Array payloads alongside UTF-8 text, retaining paste chunking; verify mixed input order, exact high-byte values, byte-limit accounting, mutation isolation, and existing Unicode/paste tests.
- [x] 3.2 Subscribe to xterm onBinary in TerminalPanel, map binary string code units to bytes, route them through the existing queue, and dispose the listener on teardown; verify delivery once, no keyboard modifier transformation of mouse payloads, and no writes after panel disposal.
- [x] 3.3 Preserve authorized input bytes through client/server input, holder framing, and both concrete node-pty write paths without lossy UTF-8 decoding; verify adapter/holder tests receive exact bytes including 0x80 and 0xff while Unicode keyboard and paste input remains correct, using the verified platform path from task 1.2.
- [x] 3.4 Extend input ownership and handoff coverage to binary reports; verify read-only refusal, lease loss, bounded pending input, retired attachment fences, and uncertain-delivery handling without duplicated reports or reordered keyboard input.

## 4. End-to-end mouse and tab return journeys

- [x] 4.1 Add a synthetic raw-input terminal program with long history and received-report markers to the Electron E2E suite; verify clicks, releases, wheel, and keyboard input reach the same PTY before and after a forced checkpoint-backed fresh attachment and recovery, for SGR and default encoding including high coordinate bytes.
- [x] 4.2 Add project/terminal tab away-and-return coverage independent of forced restoration; verify the session id is unchanged and click, wheel, and keyboard markers continue. If it fails without restoration, capture the actual input/attachment state and resolve that cause before claiming the reported journey is fixed.
- [x] 4.3 Verify disabling mouse tracking restores drag selection and viewport scrolling through retained history, including checkpoint restoration over previously active tracking; retain coverage that non-finite synthetic gesture coordinates never reach the PTY.
- [x] 4.4 Run the focused Electron journeys only through npm run test:e2e and retain their results; completion requires passing actual PTY-observation assertions, not only screenshots or emulator modes.

## 5. Final checks

- [x] 5.1 Run the affected server-core checkpoint/adapter/holder suites, renderer input queue tests, relevant client-core tests, workspace typechecks, and lint for changed files; verify all required checks pass and report any platform test that could not run.
- [x] 5.2 Run openspec validate --all --archived and validate this change; verify the change passes, distinguish unrelated existing failures, and confirm the final diff stays within the proposed terminal mouse repair and tests.
