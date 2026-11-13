## ADDED Requirements

### Requirement: Container listing uses filters every engine accepts

Container listings over the engine socket SHALL send only filter keys that both Docker and Podman accept, and SHALL send positive filters unchanged. Label exclusions SHALL be applied by the server to the labels the engine returns, and SHALL NOT reach the engine. A container matching any exclusion SHALL be omitted.

#### Scenario: Dashboard status on rootful Docker

- **WHEN** the selected engine is a reachable rootful Docker whose identity marker matches the pin, and the Bots dashboard reads engine status
- **THEN** the read succeeds, reports Docker as available, and counts the server's managed bot containers

#### Scenario: Helper containers are not counted

- **WHEN** the server has a managed bot container and a helper container labelled `terminay.helper` that carries the same server, bot and managed labels, and another server has a managed bot container on the same engine
- **THEN** the dashboard counts one bot container on both Docker and Podman

#### Scenario: Label negation never reaches the engine

- **WHEN** a container listing with label exclusions and otherwise supported filters is made against an engine that answers unknown filter keys with HTTP 400
- **THEN** the request carries only the positive filters, and the listing succeeds

#### Scenario: Key and value exclusions

- **WHEN** a listing excludes the key `a` and the label `b=x=y`, and the engine returns containers labelled `a=` (empty value), `a=1`, `b=x=y`, `b=x`, and one with no labels
- **THEN** the listing contains only the containers labelled `b=x` and the one with no labels, because a key exclusion matches any value including empty, and a `key=value` exclusion matches only the exact value after the first `=`
