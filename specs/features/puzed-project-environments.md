# Puzed project environments

## Summary

The official Puzed extension connects a Terminay Server to one or more Puzed
Platform installations, lets users reopen Terminay-created VMs carrying the
exact `system:Terminay` tag, and creates new tagged VM-backed projects through a
focused progressive workflow. Arbitrary Puzed VMs are outside the integration.
Puzed owns VM inventory and infrastructure lifecycle; the SSH extension owns
terminal and filesystem execution on the resulting VM.

Closing a Terminay project never stops or deletes its VM. Puzed management and
SSH workspace connectivity remain independent so a live workspace can continue
when the Platform API is temporarily unavailable.

## Extension composition

`terminay-plugin-puzed` is an independently publishable npm package under
`extensions/puzed`, a built-in extension, and an official catalogue entry. It
declares a compatible SSH extension/provider dependency
through the public [extension platform](./extension-platform.md). It never
imports SSH internals, receives an SSH private key, or duplicates a remote PTY/
filesystem implementation.

A composed environment retains:

- Puzed Platform profile and immutable VM id for management identity;
- durable provisioning operation/idempotency/job state where applicable;
- SSH binding/profile revision and private-key secret reference owned by SSH;
- stable logical SSH host identity based on Platform profile plus VM id;
- current dial address/override, port, username, and project root; and
- independent Puzed-management and SSH-runtime statuses.

Puzed concepts do not enter core workspace/terminal/filesystem types beyond
safe provider presentation/status.

## Platform profiles and authentication

A Puzed Platform profile contains display name, exact base URL, API-key vault
reference, optional default SSH username, optional default project root, and
redacted organization/capability metadata.

The API key is sent only as an HTTPS `Authorization: Bearer` header from the
selected Terminay Server. URLs use HTTPS by default, with an explicit loopback
development exception, and reject credentials, query, and fragment. Redirects
cannot forward authorization to another origin. Requests enforce body limits,
timeouts, cancellation, same-origin validation, and sanitized errors.

**Test connection** calls the authenticated identity endpoint and shows the
organization plus effective capabilities without redisplaying the key. The
initial integration requires `machines:write`, `images:read`, `workers:read`,
`networks:read`, `jobs:read`, and `events:read`. `settings:read` enables the
Platform's image/size/network defaults and is required for the full create
journey. `jobs:write` is not required unless Terminay later exposes job
cancellation. Missing mandatory scopes fail validation with their exact safe
names.

One API key is bound by Puzed to one organization. Terminay neither adds a
second organization selector nor copies the key into an SSH profile.

## Puzed API contract

The initial provider uses the public versioned Puzed API rather than UI routes:

- `GET /api/v1/me` validates identity, organization, key metadata, and scopes;
- `GET /api/v1/org/settings`, `/api/v1/images`, `/api/v1/workers`, and bridge
  routes populate create defaults and bounded choices;
- `GET /api/v1/machines`, machine detail/interfaces, and
  `GET /api/v1/jobs/{id}` supply durable infrastructure truth;
- `GET /api/v1/events` supplies resumable invalidations which trigger bounded
  resource refetches;
- `POST /api/v1/machines` creates with a durable `Idempotency-Key` and returns
  the VM plus job identity;
- `POST /api/v1/machines/{id}/power` performs idempotent legal power actions;
  and
- `DELETE /api/v1/machines/{id}` requires current `If-Match`, a durable
  `Idempotency-Key`, explicit disk disposition, and destructive confirmation.

The API adapter retains provider envelopes and route-specific errors. Core and
clients receive only bounded provider-neutral inventory, progress, status, and
action descriptors.

## Existing Terminay VM projects

The provider requests machine inventory with the exact `system:Terminay` tag
filter, lists only those VMs in bounded/searchable results grouped by Platform
profile, and distinguishes Running, Stopped, Paused, Provisioning, Failed,
Stale, and Unreachable states. A machine without that tag cannot be selected,
even if a user could separately provide SSH credentials.

- A running VM validates SSH access and root before creating the project.
- A stopped VM asks **Start and open** and follows the idempotent Puzed power
  job before waiting for address and SSH.
- A paused VM uses the legal resume lifecycle.
- A provisioning VM resumes observation from its machine/job truth.
- A stale worker state is labelled last-known and is not treated as ready.

Terminay-created VMs reopen using their retained SSH binding and vault key.
The provider does not offer arbitrary existing-VM adoption or credential
selection. A tagged VM whose corresponding private-key binding is unavailable
is shown as non-openable with a recovery explanation; the tag is inventory
eligibility, not secret material and cannot reconstruct a lost private key.

External VM deletion leaves the environment/project visibly detached. Terminay
never silently provisions a replacement.

## New VM creation

The create journey is a full responsive route using Puzed's existing calm,
single-scroll, progressive-disclosure model:

1. **Platform** only when the journey has not already been opened for a specific
   Platform profile; a profile-scoped create route does not repeat the profile
   selector.
2. **Boot source:** searchable ready, SSH-capable, cloud-init images. Blank or
   non-connectable sources are unavailable with an explanation.
3. **Size:** organization size presets as radio cards with the organization
   default preselected, plus Custom vCPU, memory, and root disk disclosure.
4. **Host:** automatic compatible placement summary plus a collapsed **Choose a
   host** disclosure; choosing a host creates the explicit override.
5. **Network:** organization/host default bridge with DHCP, plus a collapsed
   **Customize network** disclosure for bridge, IP mode, and static addressing.
6. **Name:** the Platform's unique random two-word suggestion, loaded on entry,
   with regeneration and editing.
7. **Project access:** dedicated Terminay-managed SSH key, username `vms` by
   default, and project root/home.
8. **Advanced:** bounded relevant Puzed fields without reproducing the entire
   Platform administration UI.
9. A sticky **Create VM and open project** action.

Async selectors are paginated, cancellable, preserve selections across
refreshes, and show disabled architecture/capacity/bridge/minimum-disk reasons.
Bridge choices are discovered from the selected worker's authoritative
`/workers/{id}/bridges` route, never from the organization-wide bridge list.
Changing the worker or refreshing options revalidates the bridge; an
incompatible stale bridge is cleared with an actionable explanation while the
rest of the draft remains intact. Immediately before create, the server repeats
that worker-scoped compatibility check before generating a binding or POSTing.
If Puzed still returns `bridge_worker_mismatch` because infrastructure changed,
Terminay preserves the draft, refreshes its choices, and exposes only the
bounded rejection so the user can correct and resubmit without a duplicate VM.
Automatic placement selects a currently compatible candidate for the required
Puzed `worker_id`; the create request remains authoritative and may reject
changed capacity/placement.

Before create, Terminay Server generates a dedicated SSH keypair. The private
key is stored only in the SSH-owned vault binding; only its public key enters
the Puzed request. Image-backed creation uses key-only guest login, username
`vms`, starts the VM, enables address observation, and lets Puzed safely compose
its org/image cloud-init defaults. Blank VMs are not accepted by the automated
project workflow. Every create request includes the exact `system:Terminay` tag
so the VM can be rediscovered without admitting unrelated machines.

The server persists a fresh idempotency key before submitting the create
request and reuses it after ambiguous responses. It immediately persists the
returned VM and job ids so reconnect/restart cannot create duplicates.

## Provisioning saga and events

The provider owns a durable server-side operation with these safe phases:

```text
Preparing -> Submitting -> Provisioning -> Booting -> Waiting for address
-> Verifying SSH -> Awaiting host trust -> Opening project -> Ready
```

Puzed creation is asynchronous. One shared authenticated SSE stream per
Platform profile/organization consumes payload-free machine/job/interface
invalidations and refetches the affected resource. It resumes with
`Last-Event-ID`, handles ready/resync, and does not poll. Connected clients can
close the route or disconnect; **Run in background** leaves the server saga
running. A server admits at most 64 distinct Puzed profile/organization streams
by default (with a hard configurable ceiling of 1,024), while all consumers of
the same pair share one stream. Concurrent resume requests for one durable
provisioning operation share one execution.

Job success does not imply that an IP or SSH is ready. After success, the
provider reads machine interfaces, waits for an observed/static address, then
hands a descriptor to SSH for bounded connection/readiness and host trust. A
stable logical identity `puzed:<platformProfileId>:<machineId>` preserves strict
key trust across DHCP address changes. A changed guest key still blocks.

If an observed address changes, live SSH sessions are not silently retargeted.
The next validated connection uses the new address and the stable host identity.

## Failure and recovery

Every timeout or failure preserves the Puzed resource and durable operation.
Terminay never auto-deletes a VM because SSH, address observation, host trust,
or project creation failed.

Recovery offers legal actions based on current truth:

- Retry connection;
- Edit SSH access/address/root;
- Start, resume, reboot, or stop the VM;
- Delete VM with explicit destructive confirmation and Puzed's disk disposition;
- Open the exact VM in Puzed Platform; and
- review bounded job failure/progress state.

Lost create responses retry with the same idempotency key. Conflicting active
jobs surface `operation-in-progress`. Puzed API outage disables management but
does not close an already-live SSH workspace. SSH outage does not imply that
the VM is stopped. Machine deletion/stop outside Terminay updates status through
events/refetch and never selects another VM.

Project close affects only Terminay workspace state. VM start/stop/reboot/delete
are explicit, permission-checked, revision/idempotency-protected infrastructure
actions. Server shutdown does not change VM power.

## Lifecycle surface

The initial in-Terminay management surface includes safe VM status and job
progress, start, stop, resume, reboot, refresh address, explicit delete, and
**Open in Puzed Platform**. Broader disks, migration, media, console, monitoring,
and Platform administration remain in Puzed rather than being duplicated.

Every action is authorized/audited with opaque profile/environment/machine ids,
safe action/result, and authenticated principal. API keys, authorization
headers, SSH material, cloud-init secrets, complete API errors, and root paths
are excluded.

## Acceptance outcomes

- A server profile validates URL/key/org/scopes without exposing its API key.
- Existing tagged running and stopped Terminay VMs follow distinct SSH/start
  journeys; unrelated or tagged-but-keyless VMs cannot be opened.
- New VM creation mirrors Puzed defaults and drilldowns while sending only the
  dedicated public SSH key.
- A lost/retried create response produces one VM through a durable idempotency
  key.
- Job, machine, and observed-address changes are event-driven, survive client
  disconnect, and resume after server restart.
- Job success waits separately for address, SSH, and host trust.
- Provisioning/SSH failure preserves the VM and offers explicit recovery; it
  never auto-deletes or falls back Local.
- Closing a project or Terminay Server changes no VM power state.
- Puzed management outage and SSH workspace outage are displayed independently.
