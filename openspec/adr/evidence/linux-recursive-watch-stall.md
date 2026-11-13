# Linux recursive `fs.watch` stalls the Terminay Server event loop

Captured 2026-11-13 on a standalone Terminay Server: Debian 13, kernel
6.12, Node v24.15.0, `main-6afe78b4`. The server observed a repository of about
70,000 entries in which an agent was running `npm run build:app`.

## What the clients saw

Desktop showed "Reconnecting… Session connect timed out after 20000ms." Every
retry timed out until the stall ended. The LAN was not involved.

## Service log timeline (first stall)

| Time (UTC) | Event |
| --- | --- |
| 13:49:47 | Last `application-lane` heartbeat. These are logged every 10 s. |
| 13:49:47 – 13:52:19 | Nothing logged by the server. `tailscaled` logged normally, so the host was live. |
| 13:52:19 | Both signaling sockets (pairing, device) close with `1006` and re-register. |
| 13:52:26 | The client rejoins and the session reconnects. |

A second stall began at 15:50:06. At 15:52:22 the main thread was still in state
`R` at 99.9% CPU; the four V8 worker threads were idle.

## Inspector samples

`SIGUSR1` opened the inspector on 127.0.0.1:9229. Each sample sent
`Debugger.pause` to the busy thread and read the stack. All six samples:

```
#watchFolder        (node:internal/fs/recursive_watch :115 readdirSync | :124 join | :125 relative)
<anon>              (recursive_watch :201)
emit
FSWatcher._handle.onchange
```

Caller: `packages/server-core/src/gitService/watcher.ts`, which runs
`fs.watch(path, { recursive: true })` on the Git directory and every working
tree.

## Reading

On Linux, Node emulates recursive watching in JavaScript. On each change it
re-walks the changed folder synchronously and does not skip ignored
directories. A build that deletes and recreates output directories keeps the
main thread busy for as long as the churn lasts.
