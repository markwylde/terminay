## ADDED Requirements

### Requirement: Host stats in the status bar

While the host stats preference is on, the right side of the status bar SHALL show the activity of the machine that runs the active tab's Terminay Server, placed before Pixel's dock and the remote access indicator. That machine is the remote host for a remote server and this computer for the Desktop Local server. The status bar SHALL show one compact item per metric, in this order: CPU, memory, network and disk I/O. Each item SHALL hold a short label, a small graph of recent samples, and the current figure. The figures are CPU use as a percentage of all cores, memory in use as a percentage of total memory, network throughput as received plus sent bytes per second, and disk throughput as read plus written bytes per second. Rates SHALL use a short human-readable unit such as `1.2 MB/s`. Each item SHALL carry an accessible name and a tooltip that give the detail behind the figure: CPU core count, memory used and total, network received and sent, and disk read and written. A metric the server reports as unavailable on its host SHALL be left out rather than shown as zero. Items SHALL follow the active tab's server: switching to a tab on another server SHALL show that server's host, and the graphs SHALL NOT mix samples from different servers. Until the first sample arrives, the items SHALL show placeholders without figures. The items SHALL fit within the status bar's height without changing it. On the Home dashboard they SHALL describe the server that the Home tab belongs to.

#### Scenario: Stats shown for a remote server

- **WHEN** the host stats preference is on and the active tab belongs to a remote server
- **THEN** the status bar shows CPU, memory, network and disk items with figures for the remote server's host

#### Scenario: Local project

- **WHEN** the host stats preference is on and the active tab belongs to the Desktop Local server
- **THEN** the items describe this computer

#### Scenario: Switching servers

- **WHEN** the user switches from a tab on one server to a tab on another server
- **THEN** the graphs restart from the second server's samples and show none of the first server's

#### Scenario: Metric unavailable on the host

- **WHEN** the server reports disk I/O as unavailable on its host
- **THEN** the status bar shows CPU, memory and network items and no disk item

#### Scenario: Tooltip detail

- **WHEN** the user hovers the memory item
- **THEN** the tooltip states the memory in use and the total memory

### Requirement: Host stats sampling

The server SHALL sample its host's CPU, memory, network and disk counters only while at least one connection is subscribed to host stats. It SHALL sample at the shortest interval any current subscriber requested and SHALL push each sample to every subscribed connection. A subscription SHALL end when the client unsubscribes or its connection closes, and the server SHALL stop sampling, start no further work, and release any resource it held for sampling once no subscription remains. The server SHALL clamp a requested interval to whole seconds from 1 to 3600. A client SHALL subscribe only while the host stats preference is on, the status bar is shown and its document is visible, and SHALL unsubscribe when any of those stops being true. Network figures SHALL count the host's physical interfaces, so traffic that also crosses a bridge, tunnel or container interface is counted once. A host with no physical interface, such as a container, SHALL count every interface other than loopback. Disk figures SHALL count whole disks and SHALL NOT count their partitions or the mapped and loop devices layered over them. A sample SHALL carry only aggregate figures for the host and SHALL NOT name processes, users, files or addresses.

#### Scenario: No subscribers

- **WHEN** no connected client has host stats on
- **THEN** the server takes no samples

#### Scenario: Last subscriber leaves

- **WHEN** the only subscribed client turns host stats off or disconnects
- **THEN** the server stops sampling

#### Scenario: Different intervals

- **WHEN** one client subscribes at 5 seconds and another at 2 seconds
- **THEN** the server samples every 2 seconds and pushes each sample to both clients

#### Scenario: Hidden document

- **WHEN** the workspace document becomes hidden
- **THEN** the client unsubscribes, and it subscribes again when the document is visible

### Requirement: Host stats preference

Whether the status bar shows host stats SHALL be a device-local preference that persists across restarts and defaults to off. The sampling interval SHALL be a second device-local preference, in whole seconds from 1 to 3600, that defaults to 5. Both SHALL appear in the Settings window, and the interval SHALL be shown only while host stats are on. A value outside the allowed range SHALL be clamped to it. Changing either preference SHALL take effect in every open workspace document on the device without a restart.

#### Scenario: Default

- **WHEN** a user opens Terminay on a device with no saved preference
- **THEN** the status bar shows no host stats and no subscription is made

#### Scenario: Turning host stats on

- **WHEN** the user turns on host stats in Settings
- **THEN** the status bar shows host stats for the active tab's server without a restart

#### Scenario: Custom interval

- **WHEN** the user sets the interval to 2 seconds
- **THEN** the client subscribes at 2 seconds and the graphs advance every 2 seconds

#### Scenario: Device-local

- **WHEN** a user turns on host stats on their desktop
- **THEN** another device connected to the same server still shows no host stats
