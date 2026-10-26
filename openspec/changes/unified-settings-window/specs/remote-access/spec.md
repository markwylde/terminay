## MODIFIED Requirements

### Requirement: Returning to the manager list

**Back to connections** SHALL return to the manager list without navigating `window.top`. From a connected workspace this action SHALL be **Switch connections** and **Terminay → Disconnect**. Desktop SHALL omit **Switch connections** because its connection menu lists every remembered profile. Returning to the manager list SHALL unload the iframe.

#### Scenario: Returning unloads the framed session

- **WHEN** the user chooses **Back to connections** or **Switch connections**
- **THEN** the manager list is shown, the iframe is unloaded, and `window.top` is not navigated

#### Scenario: Desktop has no switch action

- **WHEN** a Desktop client displays its connection menu
- **THEN** **Switch connections** is absent and every remembered profile is listed

