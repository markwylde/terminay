## MODIFIED Requirements

### Requirement: Provider creation actions

Every running provider with a profile form SHALL contribute a clear creation action. For Puzed this SHALL be **New Puzed provider…**; saving it SHALL store its URL and API-key secret and return to that provider detail without creating a VM or project, and that detail SHALL expose **Create VM…**, **Browse Terminay VMs…**, and its provider-scoped connection list. **Create VM…** SHALL open that provider's profile-scoped VM provisioning form and **Browse Terminay VMs…** SHALL open that provider's tagged VM inventory; both SHALL be connection actions that preserve the provider selection and SHALL NOT edit or replace the provider. Saving SSH SHALL create a saved SSH connection, offered from the reserved SSH provider as **Add SSH connection…**. Installing or enabling a provider SHALL make these actions available without restarting the app, and focusing the window SHALL refresh provider inventory. Extension installation and updates SHALL NOT be duplicated in this window; links that require an environment provider SHALL open Settings at its **Extensions** section.

#### Scenario: Saving a new Puzed provider

- **WHEN** **New Puzed provider…** is saved
- **THEN** its URL and API-key secret are stored and the view returns to that provider detail
- **AND** no VM or project is created, and **Create VM…**, **Browse Terminay VMs…**, and the provider-scoped connection list are exposed

#### Scenario: Browsing a provider's VMs

- **WHEN** **Browse Terminay VMs…** is activated from a Puzed provider detail
- **THEN** that provider's tagged VM inventory opens with the provider selection preserved
- **AND** the provider record is not edited or replaced

#### Scenario: Adding an SSH connection

- **WHEN** **Add SSH connection…** is activated from the reserved SSH provider
- **THEN** an SSH connection form opens and saving it creates a saved SSH connection

#### Scenario: Provider newly installed

- **WHEN** a provider is installed or enabled
- **THEN** its creation actions become available without restarting the app
- **AND** focusing the window refreshes provider inventory

#### Scenario: Extension link

- **WHEN** a link requires an environment provider that is not installed
- **THEN** Settings opens at its **Extensions** section rather than duplicating installation in this window

### Requirement: Creation and editing as modes of the management surface

Creation and editing SHALL be modes of the Project Environments management surface: the standard environment sidebar, search, server authority, and footer SHALL remain visible while the right-hand pane shows the form. Cancel and successful Save SHALL return to the selected environment. Cancel from a provider form SHALL return to the previously selected management item, Cancel from VM or SSH connection creation SHALL return to its owning provider detail, and a successful ordinary edit or save SHALL return to the edited item. No form outcome SHALL silently redirect to another provider, connection, or project. Provider creation SHALL be offered as one compact sidebar action or menu, not as a row of floating buttons in the detail header.

#### Scenario: Editing a connection

- **WHEN** a connection form is opened
- **THEN** the sidebar, search, server authority, and footer remain visible while the form occupies the right-hand pane
- **AND** Cancel or a successful Save returns to the selected environment

#### Scenario: Cancelling connection creation

- **WHEN** VM or SSH connection creation is cancelled
- **THEN** the view returns to the owning provider detail

#### Scenario: Cancelling a provider form

- **WHEN** a provider form is cancelled
- **THEN** the view returns to the previously selected management item
- **AND** no other provider, connection, or project is selected in its place
