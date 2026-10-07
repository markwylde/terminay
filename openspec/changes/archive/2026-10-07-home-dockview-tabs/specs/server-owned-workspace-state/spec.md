## MODIFIED Requirements

### Requirement: Client-owned device-local state

Desktop and browser hosts SHALL keep only state inherently local to that device:
remembered server labels and non-secret connection metadata; encrypted device
keys and reconnect credentials; native window geometry and the mapping from
local windows to server and view ids; the window's composition, being its primary
connection, its set of attached connections, the workspace view attached on each
of them, and the order of the project tabs drawn from them; which project tab and
which terminal or panel is active in each connected presentation; the Home tabs
open on the device and their arrangement; sidebar visibility for each server and
project pair; transient dialogs, menus, selection, drag previews, and optimistic
UI state; hardware and host capabilities such as microphone permission; and
explicitly device-specific accessibility or input overrides. The composition and
the Home tab arrangement MUST NOT be sent to any server. Client-local state
MUST NOT be required to recover project membership, panel identity, or a live
terminal after reconnect.

#### Scenario: Active selections differ per client

- **WHEN** two clients of the same server show different active projects and
  terminals
- **THEN** both still share the same ordered project and panel lists

#### Scenario: Recovery without client state

- **WHEN** a client reconnects with no local workspace state
- **THEN** project membership, panel identity, and live terminals are recovered
  from the server

#### Scenario: Composition is device-local

- **WHEN** a window attaches a server, reorders its tabs, and another device
  connects to the same servers
- **THEN** the composition is stored only on the first device, no server records
  it, and the second device keeps its own composition

#### Scenario: Home tabs are device-local

- **WHEN** a device opens, arranges, and closes Home tabs
- **THEN** no server records the change and no other device's Home tabs change
