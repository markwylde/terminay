## ADDED Requirements

### Requirement: Git execution safety and server boundary

Git commands SHALL run through the server's native Git service, authorized by Terminay Server and never in the client. Quick Push SHALL send only the bounded context needed to the selected provider, SHALL require explicit user confirmation before mutation, and SHALL report the exact failed Git step. Credentials SHALL remain within the server's bounded Git or CLI runner or its scoped server vault references, and SHALL NOT be copied into renderer state or generic Terminay settings.

#### Scenario: Git runs on the server

- **WHEN** a Git command is issued for a project
- **THEN** it runs through the native Git service of the server that owns the project, authorized by Terminay Server and never in the client

#### Scenario: Failed step reporting

- **WHEN** a Git step of a Quick Push plan fails
- **THEN** the exact failed step is reported

#### Scenario: Credential containment

- **WHEN** Git or provider credentials are used
- **THEN** they stay in the server's bounded runner or scoped server vault references and never enter renderer state or generic Terminay settings

## MODIFIED Requirements

### Requirement: Server-routed Git ownership

Git, worktree, provider CLI, and Quick Push execution SHALL be performed by the selected Terminay Server under server-owned workspace state. Local and remote clients SHALL submit the same scoped commands. Review and confirmation SHALL remain a client interaction, while the server SHALL revalidate repository state and authorization immediately before every mutation.

#### Scenario: Local and remote clients submit identical commands

- **WHEN** a local client and a remote client perform the same Git action
- **THEN** both submit the same scoped commands to the selected server

#### Scenario: Revalidation before mutation

- **WHEN** the server is about to perform a Git mutation
- **THEN** it revalidates repository state and authorization immediately beforehand

## REMOVED Requirements

### Requirement: Git execution safety and environment boundary

**Reason:** A project's repository lives on the server that owns it, so there is no declared environment Git capability, no supplied runner or path adapter, and no path belonging to another machine.

**Migration:** None. The surviving authorization, confirmation, reporting, and credential-containment rules are stated by "Git execution safety and server boundary".
