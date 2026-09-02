# puzed-project-environments Specification

## Purpose

Define how the official Puzed extension connects a Terminay Server to Puzed Platform installations so users can reopen Terminay-created VMs and create new tagged VM-backed projects, while Puzed owns infrastructure lifecycle and the SSH extension owns terminal and filesystem execution.

## Requirements

### Requirement: Puzed integration scope

The Puzed extension SHALL connect a Terminay Server to one or more Puzed Platform installations, SHALL allow users to reopen Terminay-created VMs carrying the exact `system:Terminay` tag, and SHALL create new tagged VM-backed projects through a progressive workflow. Arbitrary Puzed VMs SHALL be outside the integration. Puzed SHALL own VM inventory and infrastructure lifecycle; the SSH extension SHALL own terminal and filesystem execution on the resulting VM.

#### Scenario: Untagged VM is out of scope
- **WHEN** a Puzed VM does not carry the exact `system:Terminay` tag
- **THEN** it is not part of the integration and cannot be opened as a Terminay project

#### Scenario: Execution belongs to SSH
- **WHEN** a Puzed-backed project runs a terminal or reads its filesystem
- **THEN** that execution is performed by the SSH extension rather than by the Puzed provider

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

### Requirement: Platform profiles

A Puzed Platform profile SHALL contain a display name, exact base URL, API-key vault reference, optional default SSH username, optional default project root, and redacted organization and capability metadata. One API key SHALL be bound by Puzed to one organization; Terminay SHALL NOT add a second organization selector and SHALL NOT copy the key into an SSH profile.

#### Scenario: Profile fields
- **WHEN** a user configures a Puzed Platform profile
- **THEN** it records display name, base URL, API-key vault reference, optional default username and project root, and redacted organization/capability metadata

#### Scenario: Key is not copied to SSH
- **WHEN** a Puzed profile is used to compose an SSH-backed environment
- **THEN** the Puzed API key is not copied into the SSH profile

### Requirement: Puzed API transport security

The API key SHALL be sent only as an HTTPS `Authorization: Bearer` header from the selected Terminay Server. URLs SHALL use HTTPS by default with an explicit loopback development exception, and SHALL reject credentials, query, and fragment. Redirects SHALL NOT forward authorization to another origin. Requests SHALL enforce body limits, timeouts, cancellation, same-origin validation, and sanitized errors.

#### Scenario: Non-HTTPS base URL
- **WHEN** a profile base URL is not HTTPS and is not a loopback development address
- **THEN** the profile is rejected

#### Scenario: URL carries credentials or query
- **WHEN** a base URL contains embedded credentials, a query string, or a fragment
- **THEN** it is rejected

#### Scenario: Cross-origin redirect
- **WHEN** a Puzed API response redirects to another origin
- **THEN** the authorization header is not forwarded to that origin

### Requirement: Test connection and scope validation

**Test connection** SHALL call the authenticated identity endpoint and show the organization plus effective capabilities without redisplaying the key. The integration SHALL require `machines:write`, `images:read`, `workers:read`, `networks:read`, `jobs:read`, and `events:read`. `settings:read` SHALL enable the Platform's image, size, and network defaults and SHALL be required for the full create journey. `jobs:write` SHALL NOT be required unless job cancellation is exposed. Missing mandatory scopes SHALL fail validation with their exact safe names.

#### Scenario: Successful test
- **WHEN** a user runs Test connection on a valid profile
- **THEN** the organization and effective capabilities are shown and the API key is not redisplayed

#### Scenario: Missing mandatory scope
- **WHEN** the API key lacks one of the mandatory scopes
- **THEN** validation fails and names the exact missing safe scope

#### Scenario: Missing settings:read
- **WHEN** the key lacks `settings:read`
- **THEN** the full create journey is unavailable because Platform image, size, and network defaults cannot be loaded

### Requirement: Versioned Puzed API contract

The provider SHALL use the public versioned Puzed API rather than UI routes: `GET /api/v1/me` for identity, organization, key metadata, and scopes; `GET /api/v1/org/settings`, `/api/v1/images`, `/api/v1/workers`, and bridge routes for create defaults and bounded choices; `GET /api/v1/machines`, machine detail/interfaces, and `GET /api/v1/jobs/{id}` for durable infrastructure truth; `GET /api/v1/events` for resumable invalidations that trigger bounded resource refetches; `POST /api/v1/machines` to create with a durable `Idempotency-Key` returning the VM plus job identity; `POST /api/v1/machines/{id}/power` for idempotent legal power actions; and `DELETE /api/v1/machines/{id}` requiring current `If-Match`, a durable `Idempotency-Key`, explicit disk disposition, and destructive confirmation.

#### Scenario: Deleting a machine
- **WHEN** a delete is submitted for a Puzed machine
- **THEN** it carries the current `If-Match`, a durable idempotency key, an explicit disk disposition, and a destructive confirmation

#### Scenario: Event-driven invalidation
- **WHEN** the events route reports an invalidation
- **THEN** the provider refetches the affected resource within bounds rather than polling

### Requirement: Provider-neutral API projection

The API adapter SHALL retain provider envelopes and route-specific errors. Core and clients SHALL receive only bounded provider-neutral inventory, progress, status, and action descriptors.

#### Scenario: Route-specific error
- **WHEN** a Puzed route returns a route-specific error
- **THEN** the adapter retains it internally and exposes only a bounded provider-neutral descriptor to core and clients

### Requirement: Tagged VM inventory

The provider SHALL request machine inventory with the exact `system:Terminay` tag filter, SHALL list only those VMs in bounded, searchable results grouped by Platform profile, and SHALL distinguish Running, Stopped, Paused, Provisioning, Failed, Stale, and Unreachable states. A machine without that tag SHALL NOT be selectable even if a user could separately provide SSH credentials.

#### Scenario: Inventory listing
- **WHEN** a user browses Puzed VMs
- **THEN** only VMs carrying the exact `system:Terminay` tag are listed, grouped by Platform profile, in bounded searchable results with a distinct state

#### Scenario: Untagged VM with known credentials
- **WHEN** a user has SSH credentials for an untagged Puzed VM
- **THEN** the VM still cannot be selected through the Puzed provider

### Requirement: Opening an existing Terminay VM

Opening a tagged VM SHALL follow its current state: a running VM SHALL validate SSH access and root before creating the project; a stopped VM SHALL offer **Start and open** and follow the idempotent Puzed power job before waiting for address and SSH; a paused VM SHALL use the legal resume lifecycle; a provisioning VM SHALL resume observation from its machine and job truth; a stale worker state SHALL be labelled last-known and SHALL NOT be treated as ready.

#### Scenario: Running VM
- **WHEN** a user opens a running tagged VM
- **THEN** SSH access and root are validated before the project is created

#### Scenario: Stopped VM
- **WHEN** a user opens a stopped tagged VM
- **THEN** Terminay offers Start and open, runs the idempotent power job, then waits for an address and SSH

#### Scenario: Paused VM
- **WHEN** a user opens a paused tagged VM
- **THEN** the legal resume lifecycle is used

#### Scenario: Stale worker state
- **WHEN** a VM's worker state is stale
- **THEN** the state is labelled last-known and the VM is not treated as ready

### Requirement: Reopening uses retained SSH binding only

Terminay-created VMs SHALL reopen using their retained SSH binding and vault key. The provider SHALL NOT offer arbitrary existing-VM adoption or credential selection. A tagged VM whose corresponding private-key binding is unavailable SHALL be shown as non-openable with a recovery explanation; the tag SHALL be inventory eligibility only and SHALL NOT reconstruct a lost private key.

#### Scenario: Missing private-key binding
- **WHEN** a tagged VM's private-key binding is unavailable
- **THEN** the VM is shown as non-openable with a recovery explanation and no credential picker is offered

### Requirement: External VM deletion leaves a detached project

External VM deletion SHALL leave the environment and project visibly detached. Terminay SHALL NEVER silently provision a replacement.

#### Scenario: VM deleted in Puzed
- **WHEN** a VM backing a Terminay project is deleted outside Terminay
- **THEN** the environment and project are shown as detached and no replacement VM is created

### Requirement: New VM create journey

The create journey SHALL be a full responsive route using a calm, single-scroll, progressive-disclosure model with these steps: Platform selection only when the journey was not already opened for a specific Platform profile; boot source from searchable ready, SSH-capable, cloud-init images; size as organization presets shown as radio cards with the organization default preselected plus a Custom vCPU, memory, and root-disk disclosure; host as an automatic compatible placement summary plus a collapsed **Choose a host** disclosure that creates an explicit override; network as the organization or host default bridge with DHCP plus a collapsed **Customize network** disclosure for bridge, IP mode, and static addressing; name from the Platform's unique random two-word suggestion loaded on entry with regeneration and editing; project access with a dedicated Terminay-managed SSH key, username `vms` by default, and project root/home; advanced with bounded relevant Puzed fields without reproducing the entire Platform administration UI; and a sticky **Create VM and open project** action.

#### Scenario: Profile-scoped create route
- **WHEN** the create journey is opened for a specific Platform profile
- **THEN** the profile selector step is not repeated

#### Scenario: Non-connectable boot source
- **WHEN** an image is blank or not SSH-connectable
- **THEN** it is unavailable in the boot-source selector with an explanation

#### Scenario: Explicit host override
- **WHEN** a user opens Choose a host and picks a host
- **THEN** an explicit placement override is created in place of automatic placement

#### Scenario: Name suggestion
- **WHEN** the create journey is entered
- **THEN** a unique random two-word Platform name suggestion is loaded and can be regenerated or edited

### Requirement: Bounded, cancellable create selectors

Async selectors SHALL be paginated, cancellable, SHALL preserve selections across refreshes, and SHALL show disabled architecture, capacity, bridge, and minimum-disk reasons.

#### Scenario: Refreshing options
- **WHEN** a user refreshes an async selector
- **THEN** existing valid selections are preserved and any disabled option states its reason

### Requirement: Worker-scoped bridge validation

Bridge choices SHALL be discovered from the selected worker's authoritative `/workers/{id}/bridges` route and never from the organization-wide bridge list. Automatic and explicit host selection SHALL use the same compatibility source, so the form cannot offer a bridge Puzed will reject for the selected worker. Changing the worker, the placement mode, the network mode, or refreshing provider options SHALL revalidate the dependent host and bridge selections; an incompatible stale bridge SHALL be cleared or blocked with a safe actionable explanation before submit while the rest of the draft remains intact. Immediately before create, the server SHALL repeat the worker-scoped compatibility check before generating a binding or POSTing, without weakening the Puzed create request as the source of truth. If Puzed returns `bridge_worker_mismatch` because infrastructure changed, Terminay SHALL preserve the draft, refresh its choices, identify the invalid selection, and expose only the bounded rejection so the user can correct and resubmit without a duplicate VM and without raw provider errors or secrets.

#### Scenario: Worker changed
- **WHEN** a user changes the selected worker after picking a bridge
- **THEN** the bridge is revalidated and cleared with an explanation if incompatible, leaving the rest of the draft intact

#### Scenario: Automatic placement uses the same source
- **WHEN** placement is automatic rather than explicit
- **THEN** bridge compatibility is resolved from the same worker-scoped source as an explicit host selection

#### Scenario: Dependent selection revalidated
- **WHEN** the placement mode, the network mode, or a refreshed option set changes
- **THEN** dependent host and bridge selections are revalidated and a stale incompatible value is cleared or blocked before submit

#### Scenario: Server-side preflight before create
- **WHEN** a create is submitted
- **THEN** the server repeats the worker-scoped compatibility check before generating an SSH binding or POSTing, and the Puzed create request remains authoritative

#### Scenario: Late bridge mismatch
- **WHEN** Puzed rejects a create with `bridge_worker_mismatch`
- **THEN** the draft is preserved, choices are refreshed, the invalid selection is identified, a bounded rejection is shown, and no duplicate VM is created

#### Scenario: Rejection commits nothing
- **WHEN** a compatibility preflight or a Puzed compatibility rejection ends a create attempt
- **THEN** no project-environment or operation record is committed and no raw provider error or secret is exposed

### Requirement: Automatic placement remains advisory

Automatic placement SHALL select a currently compatible candidate for the required Puzed `worker_id`; the create request SHALL remain authoritative and may reject changed capacity or placement.

#### Scenario: Capacity changed before create
- **WHEN** placement capacity changes between selection and submission
- **THEN** the create request may reject the placement and the rejection is surfaced

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

### Requirement: Durable idempotency for create

The server SHALL persist a fresh idempotency key before submitting the create request and SHALL reuse it after ambiguous responses. It SHALL immediately persist the returned VM and job ids so reconnect or restart cannot create duplicates.

#### Scenario: Lost create response
- **WHEN** the create response is lost or ambiguous
- **THEN** the retry reuses the same idempotency key and exactly one VM results

#### Scenario: Restart after create
- **WHEN** the server restarts immediately after a create returns
- **THEN** the persisted VM and job ids prevent a duplicate create

### Requirement: Durable provisioning saga phases

The provider SHALL own a durable server-side operation with the safe phases Preparing, Submitting, Provisioning, Booting, Waiting for address, Verifying SSH, Opening project, and Ready.

#### Scenario: Phase reporting
- **WHEN** a provisioning operation is observed
- **THEN** its current phase is one of the named safe phases

### Requirement: Shared event stream per profile organization

Puzed creation SHALL be asynchronous. One shared authenticated SSE stream per Platform profile and organization SHALL consume payload-free machine, job, and interface invalidations and refetch the affected resource. It SHALL resume with `Last-Event-ID`, SHALL handle ready and resync, and SHALL NOT poll. A server SHALL admit at most 64 distinct Puzed profile/organization streams by default with a hard configurable ceiling of 1,024, while all consumers of the same pair share one stream.

#### Scenario: Multiple consumers
- **WHEN** several consumers observe the same Platform profile and organization
- **THEN** they share one event stream

#### Scenario: Stream interruption
- **WHEN** the event stream drops
- **THEN** it resumes using `Last-Event-ID` and handles resync rather than polling

#### Scenario: Stream ceiling
- **WHEN** more than the configured number of distinct profile/organization streams is requested
- **THEN** the server admits at most the configured limit, defaulting to 64 with a hard ceiling of 1,024

### Requirement: Background continuation and restart recovery

Connected clients SHALL be able to close the create route or disconnect; **Run in background** SHALL leave the server saga running. Concurrent resume requests for one durable provisioning operation SHALL share one execution. Server startup SHALL resume every durable pending operation after extensions activate, and that recovery SHALL NOT depend on a renderer opening the Project Environments surface. Each durable operation SHALL receive its own bounded recovery attempt, scheduled newest-first, so an older VM whose SSH endpoint is unavailable never consumes the recovery window needed for a newer VM.

#### Scenario: Client disconnects mid-provision
- **WHEN** a client closes the create route or disconnects while a saga runs
- **THEN** the server saga continues to completion

#### Scenario: Server restart with pending operations
- **WHEN** the server restarts with durable pending operations
- **THEN** every pending operation resumes after extensions activate without any renderer opening Project Environments

#### Scenario: Unreachable older VM
- **WHEN** an older operation's SSH endpoint is unreachable during recovery
- **THEN** its bounded attempt does not prevent a newer operation from advancing, because recovery is scheduled newest-first with per-operation bounds

### Requirement: Address and SSH readiness after job success

Job success SHALL NOT imply that an IP or SSH is ready. After success, the provider SHALL read machine interfaces, SHALL wait for an observed or static address, then SHALL hand a descriptor to SSH for a bounded connection and readiness check. A guest that has no reachability SHALL remain retryable in the SSH readiness phase and SHALL NOT be reported ready.

#### Scenario: Job succeeds without address
- **WHEN** the Puzed job succeeds but no address is observed yet
- **THEN** the operation waits for an address before attempting SSH and is not reported as ready

#### Scenario: Address answers nothing
- **WHEN** a guest address is observed but the guest does not answer SSH
- **THEN** the operation stays in the SSH readiness phase as retryable and is never reported ready

### Requirement: Automatic initial host-key pinning for created VMs

For a VM Terminay created, where Terminay generated the SSH key and supplied its public half in the same create request, the provider SHALL pin that VM's initial host key automatically and immediately re-verify the connection. A stable logical identity `puzed:<platformProfileId>:<machineId>` SHALL preserve strict key trust across DHCP address changes. This automatic initial pin SHALL NOT be presented as a user trust prompt. A changed guest key SHALL still block and require explicit approval. Initial-key pinning SHALL be automatic only for a VM created by this provider, never for an existing or manually composed connection.

#### Scenario: First connection to a created VM
- **WHEN** Terminay first connects to a VM it created
- **THEN** the initial host key is pinned automatically without a user trust prompt

#### Scenario: Guest key changes later
- **WHEN** a previously pinned VM presents a different host key
- **THEN** the connection blocks and requires explicit approval

#### Scenario: DHCP address change
- **WHEN** a created VM's dial address changes
- **THEN** strict key trust is preserved through the stable logical identity `puzed:<platformProfileId>:<machineId>`

#### Scenario: Manually composed connection
- **WHEN** a connection is existing or manually composed rather than created by this provider
- **THEN** no automatic initial key pin occurs

### Requirement: Provider status cards

While a durable operation remains provisioning, its provider MAY expose a safe status card. Status-card facts and actions SHALL be optional public extension API fields, and clients SHALL render omitted fields as empty lists rather than rejecting the whole environment snapshot. A changed-host-key challenge SHALL offer an explicit replacement action from the pending VM connection; a client SHALL NOT need to wait for the operation to become ready before it can approve the key.

#### Scenario: Omitted status fields
- **WHEN** a status card omits optional facts or actions
- **THEN** the client renders empty lists and still accepts the environment snapshot

#### Scenario: Host-key challenge during provisioning
- **WHEN** a pending VM connection reports a changed host key
- **THEN** an explicit replacement action is offered without waiting for the operation to reach Ready

### Requirement: Honest connection-chooser status

The connection chooser SHALL project live provider status: an already-created VM awaiting SSH SHALL be shown as **Connecting**, or **Offline** when SSH is unreachable, and SHALL NOT be shown as still creating a VM.

#### Scenario: Created VM awaiting SSH
- **WHEN** a VM exists but SSH is not yet verified
- **THEN** the chooser shows Connecting, or Offline when SSH is unreachable, rather than a creating state

### Requirement: Non-blocking status refresh

Background connection-status polling SHALL be non-blocking UI work that refreshes the visible inventory without presenting a persistent global working state or hiding saved providers and connections. An initial or explicit refresh SHALL be bounded and SHALL report an in-flow retryable error if the selected server does not respond.

#### Scenario: Background refresh
- **WHEN** connection statuses refresh in the background
- **THEN** saved providers and connections stay visible and no persistent global working state is shown

#### Scenario: Server does not respond to refresh
- **WHEN** an explicit refresh exceeds its bound without a server response
- **THEN** an in-flow retryable error is reported

### Requirement: Status snapshots do not open channels

Provider status snapshots SHALL be projections of durable connection state and SHALL NOT open SSH or SFTP channels. SSH verification SHALL belong to the create/resume operation and an explicit retry action. That retry SHALL re-run SSH verification and SHALL reach **Ready** only on successful verification. Connection failures SHALL remain a bounded retryable SSH state and SHALL NOT claim the project environment is available.

#### Scenario: Listing provider inventory
- **WHEN** provider status snapshots are produced for inventory
- **THEN** no SSH or SFTP channel is opened, so a stale or slow VM cannot block inventory or compete with a project filesystem request

#### Scenario: Explicit retry succeeds
- **WHEN** a user triggers the explicit retry action and SSH verification succeeds
- **THEN** the environment reaches Ready

#### Scenario: Explicit retry fails
- **WHEN** SSH verification fails
- **THEN** a bounded retryable SSH failure state is reported and the environment is not claimed to be available

### Requirement: Address change does not retarget live sessions

If an observed address changes, live SSH sessions SHALL NOT be silently retargeted. The next validated connection SHALL use the new address with the stable host identity.

#### Scenario: Address changes while sessions are live
- **WHEN** a VM's observed address changes during a live session
- **THEN** existing sessions are not retargeted and only the next validated connection uses the new address

### Requirement: Failures preserve the VM

Every timeout or failure SHALL preserve the Puzed resource and durable operation. Terminay SHALL NEVER auto-delete a VM because SSH, address observation, host trust, or project creation failed, and SHALL NEVER fall back to the Terminay Server machine.

#### Scenario: SSH verification times out
- **WHEN** SSH verification, address observation, host trust, or project creation fails
- **THEN** the VM and its durable operation are preserved and no local fallback occurs

### Requirement: Recovery actions

Recovery SHALL offer legal actions based on current truth: retry connection; edit SSH access, address, or root; start, resume, reboot, or stop the VM; delete the VM with explicit destructive confirmation and Puzed's disk disposition; open the exact VM in Puzed Platform; and review bounded job failure and progress state.

#### Scenario: Recovering a failed provision
- **WHEN** a user opens recovery for a failed operation
- **THEN** the offered actions are limited to those legal for the VM's current truth

#### Scenario: Deleting from recovery
- **WHEN** a user deletes the VM from recovery
- **THEN** explicit destructive confirmation and a disk disposition are required

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

### Requirement: Explicit, protected infrastructure actions

Project close SHALL affect only Terminay workspace state. VM start, stop, reboot, and delete SHALL be explicit, permission-checked, and revision- and idempotency-protected infrastructure actions.

#### Scenario: Power action
- **WHEN** a user starts, stops, reboots, or deletes a VM
- **THEN** the action is explicit, permission-checked, and protected by revision and idempotency

### Requirement: Lifecycle management surface

The in-Terminay management surface SHALL include safe VM status and job progress, start, stop, resume, reboot, refresh address, explicit delete, and **Open in Puzed Platform**. Broader disks, migration, media, console, monitoring, and Platform administration SHALL remain in Puzed rather than being duplicated.

#### Scenario: Managing a VM in Terminay
- **WHEN** a user opens the Puzed lifecycle surface
- **THEN** status, job progress, power actions, refresh address, explicit delete, and Open in Puzed Platform are available and no broader Platform administration is duplicated

### Requirement: Authorized and redacted auditing

Every action SHALL be authorized and audited with opaque profile, environment, and machine ids, safe action and result, and the authenticated principal. API keys, authorization headers, SSH material, cloud-init secrets, complete API errors, and root paths SHALL be excluded from audit records.

#### Scenario: Audit record content
- **WHEN** a Puzed action is audited
- **THEN** the record carries opaque ids, safe action and result, and the principal, and excludes keys, headers, SSH material, cloud-init secrets, full API errors, and root paths
