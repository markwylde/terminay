## Context

The status bar shows the focused terminal, Pixel's dock and the remote access
indicator. Nothing in Terminay reports how busy the machine behind a server is,
and no server code reads host-wide CPU, memory, network or disk counters
today. The workspace bundle talks to many servers at once (ADR-0018). The
status bar already follows the active tab's server for the remote indicator
and Pixel (`usePixelServer`), and host stats follow it the same way.

## Goals / Non-Goals

**Goals:**

- Small live graphs and current figures for CPU, memory, network and disk I/O
  of the active tab's server host, off by default, with a device-local switch
  and a configurable interval.
- No work on any server while nobody is looking.

**Non-Goals:**

- Per-process, per-interface, per-disk or per-core breakdowns.
- History beyond what the client keeps in memory for the graph. Nothing is
  persisted.
- Network and disk counters on Windows hosts. They need PDH or IP Helper calls
  through koffi, and are left to a follow-up. Windows hosts report CPU and
  memory, and the other two items are omitted.

## Decisions

### 1. An owner-approved poll, owned by its subscribers (ADR-0028)

Host CPU, memory, network and disk counters are cumulative kernel counters.
No operating system raises an event when they change, so no watch or
subscription can replace sampling. ADR-0028 therefore requires the owner's
approval.

**Owner approval:** Mark Wylde approved the poll on 2026-11-13. He was asked:
"Host CPU, memory, network and disk counters have no change events, so live
status-bar graphs need the Terminay server to sample them on a timer. That is
a poll, which ADR-0028 says only you can approve. The proposal is that the
server samples only while at least one connected client has the host stats
switched on and its window visible, and stops when none does. Do you approve
that poll, and at what interval?" He answered "yes, default 5s. but let the
user override in settings to whatever interval they want". The code site cites
ADR-0028 and this change.

How the poll is bounded:

- The interval defaults to 5 s. It is a device-local setting, which the server
  clamps to whole seconds from 1 to 3600. One second is the floor, so a client
  cannot make the server sample faster than once a second.
- The poll is owned by its subscriptions (ADR-0028 decision 6). The server
  keeps `connectionId → intervalMs` for each watching connection. The first
  watch arms one timer and the last unwatch or connection close clears it. The
  timer runs at the smallest requested interval, and a watch or unwatch that
  changes that minimum re-arms it. `closeConnection` is called from the
  composition's `onConnectionClosed`, and `dispose` from shutdown. The timer
  is `unref`ed so it never keeps a server process alive.
- A client watches only while `hostStats.enabled` is on, the status bar is
  shown, the active tab belongs to that server, and `document.visibilityState`
  is `visible`. Each of those changing tears the watch down.

### 2. Protocol: a feature capability, a watch command and a transient event

`@terminay/protocol` gains `hostStats.ts` with `HOST_STATS_CAPABILITY`
(`host-stats.v1`, also in `FEATURE_CAPABILITIES` and the bundle's optional
capabilities), the operations `host-stats.watch {intervalSeconds}` and
`host-stats.unwatch`, the event `host-stats.sample`, and the sample type. Both
commands have `read` scope. A sample is published with `publishTransient`, so
it is never replayed or persisted. It carries no `clientId`, so every
connection subscribed to the event receives it. The client subscribes to the
event before it sends `watch`, so the first sample cannot be missed. The
`host-stats` namespace maps to the new capability in the server's operation
table. Constants live in `@terminay/protocol` so the workspace UI and the
server share one definition.

**Boundary: remote access and authority.** A sample is aggregate host data:
percentages, byte totals, rates and a core count. It names no process, user,
file, interface, disk or address. Any connection that holds read scope on the
server may watch. A session-bound or project-bound client sees the same host
figures as any other, because the figures are not scoped to a project and
reveal nothing about another project's content.

### 3. Sampling sources per platform, with no per-tick spawn where avoidable

| Metric  | Linux                                    | macOS                                                           | Windows       |
|---------|------------------------------------------|-----------------------------------------------------------------|---------------|
| CPU     | `os.cpus()` tick deltas                  | `os.cpus()` tick deltas                                         | `os.cpus()`   |
| Memory  | `/proc/meminfo` `MemTotal - MemAvailable`| `os.totalmem()` and `sysctl` free, speculative, purgeable and file-backed page counts | `os.totalmem() - os.freemem()` |
| Network | `/proc/net/dev`, every interface except `lo` | `netstat -ibn` link rows of `en<n>` ports, or every interface except `lo*` when there are none | unavailable   |
| Disk    | `/proc/diskstats` whole disks (sectors × 512), excluding `loop`, `ram`, `zram`, `dm-`, `md` and `sr` devices and partitions | `ioreg -r -c IOBlockStorageDriver` `Bytes (Read/Write)` | unavailable |

On Linux every sample reads files only, with no process spawn. On macOS
Node's `os.freemem()` counts only free pages, so memory would read nearly
full. Network and disk have no file source. Each macOS sample therefore runs
one `/bin/sh -c` that prints `sysctl`, `netstat` and `ioreg` output separated
by markers. That costs one shell and three short-lived tools per sample. At
the default 5 s that is acceptable, and it happens only while someone is
watching (ADR-0021 measures background cost in spawns). The Linux virtual-interface list is
re-read on every sample, so an interface created while stats are shown is
classified correctly. When the last watcher leaves, the read in flight is
aborted, which kills the macOS shell before it starts its remaining tools.
If a source fails or
cannot be parsed, its metric is reported as `null` (unavailable) and the
other metrics are unaffected.

Rates and CPU use are deltas between consecutive readings, so the server takes
a baseline reading when the timer is armed and publishes the first sample one
interval later. A counter that goes backwards, as after an interface reset, is
treated as zero for that interval.

All readers sit behind an injectable `HostCounterReader` so the sampler is
tested with fixed counters and a fake clock. The parsers are pure functions
tested against fixture text.

### 4. Client: a hook keyed by server, a pure model and an SVG sparkline

`useHostStats(entry, { enabled, intervalSeconds })` follows the
`usePixelServer` shape. It builds a facade for the entry's
`applicationClient`, gates on `HOST_STATS_CAPABILITY`, subscribes, watches,
and keeps a bounded ring of the last 30 samples in state. Because the effect
depends on the transport, switching servers resets the ring, so samples from
different servers never mix. `hostStatsModel.ts` holds the pure formatting:
rates, percentages, tooltip text and sparkline points. The status bar renders
a `HostStatsStrip` before Pixel's slot. Each metric is a label, a 32×12 inline
SVG polyline and a figure, sized to the existing bar height. CPU and memory
graphs use a fixed 0–100 scale. Network and disk graphs scale to the largest
rate in view.

### 5. Settings: device-local `hostStats`

`TerminalSettings.hostStats = { enabled: boolean; intervalSeconds: number }`,
defaulting to `{ enabled: false, intervalSeconds: 5 }`. It is not in
`SERVER_OWNED_TERMINAL_SETTING_KEYS`, so it persists on the device like
`showStatusBar`, and it is classified `connection-host` on the server. The
setting gets a new **Status Bar** section in the Appearance category with a
boolean field and a number field (1–3600, step 1). The number field is
visible only when host stats are on. Normalisation rounds and clamps the
interval.

## Risks / Trade-offs

- macOS parsers are written against documented output formats and unit-tested
  with fixtures, but CI runs node tests on Linux. → The task list includes a
  manual check on a macOS host. A parse failure degrades to an omitted metric,
  never to a wrong figure or an error.
- A 1 s interval on macOS spawns four processes a second. → This is allowed
  because the owner asked for a user-chosen interval. The default is 5 s, and
  the floor is 1 s.
- A client that crashes without closing its connection keeps the timer armed
  until the connection's liveness check closes it. → This is the same
  lifetime as every other per-connection resource.
