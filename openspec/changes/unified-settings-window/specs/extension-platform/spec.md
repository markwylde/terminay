## MODIFIED Requirements

### Requirement: Extensions entry points

The **Extensions** command, from the Command Bar or its accelerator, and the Extensions category in the Settings sidebar SHALL open or focus Settings at
its **Extensions** section. On Desktop this SHALL use the established Settings
auxiliary window; in a browser it SHALL use the established in-page Settings
route and select the same section. Repeated invocation SHALL focus the existing
Settings presentation rather than stacking another dialog.

#### Scenario: Repeated invocation

- **WHEN** an Extensions entry point is invoked while Settings is already open
- **THEN** the existing Settings presentation is focused at the Extensions section
  and no additional dialog is stacked

#### Scenario: Same section from every entry point

- **WHEN** the user opens Extensions from the Command Bar or from the Settings sidebar
- **THEN** both focus the same selected-server Settings section with the
  established Settings visual and window behaviour

