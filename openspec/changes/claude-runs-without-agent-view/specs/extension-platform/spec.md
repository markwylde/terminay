## MODIFIED Requirements

### Requirement: Terminal command default contribution and registration

A package SHALL declare each terminal command default under `contributes.terminalCommandDefaults`. Each declaration SHALL carry a namespaced id, the command name it applies to, and optionally the harness it belongs to, named by the id of a session source the same package declares and a harness id that source declares. The command name SHALL be fixed by the manifest and SHALL meet the command-name rules of the terminal command defaults registry.

At activation the extension SHALL register each declared command default through `context.terminals.registerCommandDefault(id, runtime)`, which SHALL return a disposable registration. Registration SHALL be refused for an undeclared id, a duplicate id, or a registration after deactivation. The runtime SHALL implement `resolve(signal)`, which returns either applies, with the arguments to place before the user's arguments, the environment to set on the integrated shell, or both, or does not apply with a bounded reason.

An applying resolution SHALL carry arguments, environment, or both. Environment SHALL hold one to four variables. Each name SHALL be upper case letters, digits, and underscores, starting with a letter, bounded in length, and SHALL NOT start with `TERMINAY_`. Each value SHALL be a bounded string with no control characters.

The host SHALL include a command default in the registry only while its extension is active, it is registered, its harness, when it names one, is switched on, and its last resolution reported that it applies with arguments and environment that meet the registry's rules. The host SHALL NOT call `resolve` for a command default whose harness is switched off. The host SHALL resolve on registration and whenever the harness is switched on, SHALL bound how long `resolve` may run, and SHALL treat a timeout or failure as does not apply. The host SHALL NOT wait for resolution while launching a terminal; a launch uses the registry as it stands.

#### Scenario: Registering a declared command default

- **WHEN** an extension registers a command default id its manifest declared
- **THEN** the registration is accepted and returns a disposable registration

#### Scenario: Harness switched off

- **WHEN** a command default names a harness and that harness is switched off
- **THEN** it is not in the registry and its `resolve` is not called

#### Scenario: Resolution reports an argument that is not a flag

- **WHEN** a command default's `resolve` returns the argument `exec`
- **THEN** the host treats it as does not apply

#### Scenario: Resolution reports environment only

- **WHEN** a command default's `resolve` reports that it applies with the environment `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` and no arguments
- **THEN** the command default is in the registry with that environment and adds no arguments

#### Scenario: Resolution reports a disallowed variable

- **WHEN** a command default's `resolve` reports a variable named `path` or `TERMINAY_COMMAND_DEFAULTS`, or a value with a newline
- **THEN** the host treats it as does not apply

#### Scenario: Resolution reports nothing to add

- **WHEN** a command default's `resolve` reports that it applies with neither arguments nor environment
- **THEN** the host treats it as does not apply

#### Scenario: Extension disabled

- **WHEN** the extension that contributes a command default is disabled
- **THEN** the command default leaves the registry and new terminals no longer receive it
