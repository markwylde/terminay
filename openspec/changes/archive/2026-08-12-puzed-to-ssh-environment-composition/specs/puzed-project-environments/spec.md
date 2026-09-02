## MODIFIED Requirements

### Requirement: Extension composition and boundaries

`terminay-plugin-puzed` SHALL be an independently publishable npm package under `extensions/puzed`, a built-in extension, and an official catalogue entry. It SHALL declare a compatible SSH extension/provider dependency through the public extension platform. It SHALL NOT import SSH internals, receive an SSH private key, or duplicate a remote PTY or filesystem implementation. Puzed concepts SHALL NOT enter core workspace, terminal, or filesystem types beyond safe provider presentation and status.

#### Scenario: Private key stays with SSH
- **WHEN** the Puzed provider composes an environment with SSH
- **THEN** it never receives the SSH private key and never reimplements the remote PTY or filesystem

#### Scenario: Core types stay provider-neutral
- **WHEN** a Puzed-backed environment is projected into workspace, terminal, or filesystem state
- **THEN** only safe provider presentation and status fields appear, not Puzed-specific concepts

### Requirement: Composed environment retained state

A composed Puzed environment SHALL retain the Puzed Platform profile and immutable VM id for management identity, durable provisioning operation/idempotency/job state where applicable, the SSH binding/profile revision and private-key secret reference owned by SSH, a stable logical SSH host identity based on Platform profile plus VM id, the current dial address or override, port, username, and project root, and independent Puzed-management and SSH-runtime statuses.

#### Scenario: Environment snapshot content
- **WHEN** a composed Puzed environment is inspected
- **THEN** it carries the Platform profile, immutable VM id, SSH binding revision and key reference, stable logical host identity, dial address, port, username, project root, and separate management and runtime statuses

#### Scenario: Independent statuses
- **WHEN** Puzed management fails while SSH remains ready
- **THEN** the two statuses are reported separately rather than collapsed into one

### Requirement: Project close never changes VM lifecycle

Closing a Terminay project SHALL never stop or delete its VM. Puzed management and SSH workspace connectivity SHALL remain independent so a live workspace continues when the Platform API is temporarily unavailable. Server shutdown SHALL NOT change VM power.

#### Scenario: Closing a project
- **WHEN** a user closes a Puzed-backed project
- **THEN** the VM keeps its current power state and is not deleted

#### Scenario: Terminay Server shuts down
- **WHEN** the selected Terminay Server shuts down
- **THEN** no VM power state changes

#### Scenario: Platform API unavailable during a live session
- **WHEN** the Puzed Platform API is temporarily unreachable while an SSH workspace is live
- **THEN** the workspace continues and only Puzed management is unavailable

### Requirement: External VM deletion leaves a detached project

External VM deletion SHALL leave the environment and project visibly detached. Terminay SHALL NEVER silently provision a replacement.

#### Scenario: VM deleted in Puzed
- **WHEN** a VM backing a Terminay project is deleted outside Terminay
- **THEN** the environment and project are shown as detached and no replacement VM is created

### Requirement: Address change does not retarget live sessions

If an observed address changes, live SSH sessions SHALL NOT be silently retargeted. The next validated connection SHALL use the new address with the stable host identity.

#### Scenario: Address changes while sessions are live
- **WHEN** a VM's observed address changes during a live session
- **THEN** existing sessions are not retargeted and only the next validated connection uses the new address

### Requirement: Independent outage semantics

Lost create responses SHALL retry with the same idempotency key. Conflicting active jobs SHALL surface `operation-in-progress`. A Puzed API outage SHALL disable management but SHALL NOT close an already-live SSH workspace. An SSH outage SHALL NOT imply that the VM is stopped. Machine deletion or stop outside Terminay SHALL update status through events and refetch and SHALL NEVER select another VM.

#### Scenario: Conflicting job
- **WHEN** a requested action conflicts with an active job
- **THEN** `operation-in-progress` is surfaced

#### Scenario: SSH unreachable
- **WHEN** SSH to a VM is unreachable
- **THEN** the VM is not reported as stopped

#### Scenario: External stop
- **WHEN** a machine is stopped or deleted outside Terminay
- **THEN** status updates through events and refetch and no other VM is selected in its place

### Requirement: Dedicated SSH keypair for created VMs

Before create, Terminay Server SHALL generate a dedicated RSA SSH keypair compatible with Puzed's cloud-init guest-key path. The private key SHALL be stored only in the SSH-owned vault binding, and only the public key SHALL enter the Puzed request. Image-backed creation SHALL use key-only guest login and username `vms`, SHALL start the VM, SHALL enable address observation, and SHALL let Puzed compose its organization and image cloud-init defaults. Blank VMs SHALL NOT be accepted by the automated project workflow. Every create request SHALL include the exact `system:Terminay` tag.

#### Scenario: Keypair generation
- **WHEN** a create is submitted
- **THEN** a dedicated RSA keypair is generated, its private half is stored only in the SSH-owned vault binding, and only its public half is sent to Puzed

#### Scenario: Blank VM rejected
- **WHEN** a blank VM source is chosen for the automated project workflow
- **THEN** creation is not accepted

#### Scenario: Tag applied at create
- **WHEN** a VM is created through Terminay
- **THEN** the request carries the exact `system:Terminay` tag so the VM can be rediscovered

### Requirement: Recovery actions

Recovery SHALL offer legal actions based on current truth: retry connection; edit SSH access, address, or root; start, resume, reboot, or stop the VM; delete the VM with explicit destructive confirmation and Puzed's disk disposition; open the exact VM in Puzed Platform; and review bounded job failure and progress state.

#### Scenario: Recovering a failed provision
- **WHEN** a user opens recovery for a failed operation
- **THEN** the offered actions are limited to those legal for the VM's current truth

#### Scenario: Deleting from recovery
- **WHEN** a user deletes the VM from recovery
- **THEN** explicit destructive confirmation and a disk disposition are required
