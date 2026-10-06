# Terminal output cost in the main process

Measurements behind [ADR-0041](../0041-output-path-work-is-proportional-to-the-output-event.md)
and the change `bound-terminal-output-cost`. Taken 2026-10-07 at commit
`85e53368` on an Apple M3 (arm64), macOS 27, Node 24.14, ~570 host processes.

## The report

A packaged build (5.14.0-beta.46) with one terminal running Claude Code over
`ssh` held the main process at 30–45% CPU: 78m45s of CPU over two days, against
38 s for the session holder that reads every byte first. `sample` showed ~30%
of main-thread samples inside a libuv stream-read callback, with heavy
`memmove`. JavaScript frames were unsymbolicated, so the report ranked its
suspects by reading the code.

## Method

`terminal-output-main-process-cost/profile-output.mjs` bundles
`electron/serverTerminalAuthority.ts` with esbuild and constructs the
production embedded composition: real `node-pty`, the real `ps`-based
foreground resolver, presentation checkpoints, activity, the lot. It creates
one `/bin/sh` terminal, attaches one consumer, prints 1.3 MB to fill the
replay, then runs the report's deterministic repaint loop:

```sh
while [ $SECONDS -lt $end ]; do printf '\033[H\033[2J'; seq 1 40; sleep 0.005; done
```

It reports `process.cpuUsage()` over the window, output chunks per second, and
`execFile` calls per second by binary (counted by wrapping
`child_process.execFile` before the bundle loads). An optional fourth argument
records a V8 CPU profile through `node:inspector`;
`summarize-profile.mjs` prints self and inclusive time by function.

```sh
node openspec/adr/evidence/terminal-output-main-process-cost/profile-output.mjs "$PWD" 10
node openspec/adr/evidence/terminal-output-main-process-cost/profile-output.mjs "$PWD" 10 0          # replay not full
node openspec/adr/evidence/terminal-output-main-process-cost/profile-output.mjs "$PWD" 10 1300000 out.cpuprofile
```

This is the in-process PTY path. The packaged app uses the session holder
(ADR-0035), which adds frame decoding in front of the same pipeline; the
per-chunk sampling on that path was confirmed separately with a real holder
(below).

## Reproduction

| Replay | Chunks/s | Main CPU | user / sys | `ps`/s |
| --- | --- | --- | --- | --- |
| Full (1.3 MB printed first) | 313 | 33.7% | 30.0 / 3.6 | 42 |
| Not full | 318 | 13.2% | 10.7 / 2.5 | 43 |

The report's 32.4% is reproduced, and the 20-point gap between the two rows is
work that exists only once a megabyte is retained.

## Attribution by ablation

Each suspect was switched off behind a temporary environment check, in the
same build, 10 s per run. The switches were not kept.

| Configuration | Main CPU | user / sys | Chunks/s | `ps`/s |
| --- | --- | --- | --- | --- |
| As shipped | 32.4% | 28.8 / 3.6 | 315 | 41.7 |
| A: authority does not rebuild its replay per event | 11.3% | 9.0 / 2.3 | 319 | 41.9 |
| B: no host sample per output chunk | 23.0% | 21.4 / 1.6 | 316 | 0.7 |
| C: running replay byte total in the service | 31.0% | 27.2 / 3.7 | 314 | 41.9 |
| A + C | 9.5% | 7.1 / 2.4 | 340 | 38.9 |
| A + B + C | 2.7% | 2.2 / 0.5 | 443 | 0.7 |

- A is worth ~21 points, B ~7–9, C ~1.5–2 at this chunk size (C grows as
  chunks shrink; see the unit figures).
- With all three off the main process does 2.7% at a 40% *higher* chunk rate.
  Everything else on the path — headless xterm checkpointing, per-listener
  copies, the activity reducer, recording decodes — fits inside that.
- The residual 0.7 `ps`/s is the 1500 ms interval sample.

## Why the JavaScript profile under-reports A

The V8 profile of the as-shipped run attributes only ~16% of wall time to the
JavaScript thread (`handleEvent` 2.5% self, garbage collector 3.6%, `spawn`
2.2%, `parseHostProcessTable` 1.6%), against 38% process CPU in the same run.
The difference is off-thread: rebuilding a 1 MiB buffer 300 times a second
allocates ~600 MB/s, and the cost lands on V8's parallel collector threads and
in kernel page zeroing. A profile of the main thread alone would have ranked A
well below its real cost. The ablation, which measures process CPU, does not
have that blind spot.

## Unit figures

From the regression tests added with the change, run against `85e53368`:

| Test | Measured | Bound |
| --- | --- | --- |
| Authority: output event with full 1 MiB replay vs 4 KiB | 110.8 µs vs 7.5 µs | ≤ 4× |
| Service: 16-byte chunk with 65,536 retained chunks vs 256 | 250.8 µs vs 1.8 µs | ≤ 4× |
| In-process PTY: host samples for 400 chunks in 7 ms | 400 | ≤ 3 |
| Real session holder: host samples for 249 frames in 2.0 s | 250 | ≤ 11 |

## After the fix

Same harness, same machine, on the build that carries the change (bounded
chunk queue behind both retainers; output-driven sampling behind the shared
ramp):

| Build | Chunks/s | Main CPU | user / sys | `ps`/s |
| --- | --- | --- | --- | --- |
| `85e53368` | 315 | 32.4% | 28.8 / 3.6 | 41.7 |
| Fixed | 486 | 2.9% | 2.4 / 0.5 | 1.0 |

The chunk rate rises because the repaint loop is no longer waiting on the
server. The remaining `ps` is the 1500 ms interval sample plus the ramp's
widening output-driven samples.
