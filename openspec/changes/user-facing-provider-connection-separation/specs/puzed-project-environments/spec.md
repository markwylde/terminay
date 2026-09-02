## MODIFIED Requirements

### Requirement: Tagged VM inventory

The provider SHALL request machine inventory with the exact `system:Terminay` tag filter, SHALL list only those VMs in bounded, searchable results grouped by Platform profile, and SHALL distinguish Running, Stopped, Paused, Provisioning, Failed, Stale, and Unreachable states. A machine without that tag SHALL NOT be selectable even if a user could separately provide SSH credentials. Inventory opened from one Puzed provider SHALL be scoped to that provider and SHALL list only its tagged VMs. Selecting or provisioning a VM from that inventory SHALL add or update only that VM as a connection owned by that provider, and SHALL NOT modify, replace, or remove the provider record or any sibling connection.

#### Scenario: Inventory listing
- **WHEN** a user browses Puzed VMs
- **THEN** only VMs carrying the exact `system:Terminay` tag are listed, grouped by Platform profile, in bounded searchable results with a distinct state

#### Scenario: Untagged VM with known credentials
- **WHEN** a user has SSH credentials for an untagged Puzed VM
- **THEN** the VM still cannot be selected through the Puzed provider

#### Scenario: Provider-scoped browsing
- **WHEN** inventory is opened from one Puzed provider
- **THEN** only that provider's tagged VMs are listed

#### Scenario: Selecting one VM
- **WHEN** a user selects or provisions one VM from a provider-scoped inventory
- **THEN** only that VM is added or updated as a connection owned by that provider
- **AND** the provider record and its sibling connections are unchanged
