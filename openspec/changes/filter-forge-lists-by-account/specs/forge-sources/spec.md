## ADDED Requirements

### Requirement: Forge lists narrowed to accounts

A forge list request SHALL accept an optional set of accounts, each a source id
and an HTTPS origin. With a set, the host forge service SHALL ask only sources
it names for accounts and only accounts it names for items, so the page, cursor,
totals, and outcomes describe only them. A set that names no answering account
SHALL produce an empty list that does not report that no account is set up.

#### Scenario: One of two accounts asked

- **WHEN** a client lists open pull requests on Home with accounts set to the
  Gitea source on `https://git.example.net`, and a GitHub account is also
  signed in
- **THEN** the GitHub source is not asked for accounts or items, and only
  `git.example.net` pull requests and outcomes are returned

#### Scenario: Unknown account

- **WHEN** a client lists issues with accounts set to an origin no source has an
  account for
- **THEN** the list is empty and no source is asked for items

### Requirement: Account narrowing never widens a list

Account narrowing SHALL only remove accounts the request would otherwise ask;
the project binding, the source's settings, and any repository filter SHALL
still apply to each named account. A present but malformed set — not an array,
larger than the service's limit, or holding an entry without a source id or an
HTTPS origin — SHALL be refused as invalid, never treated as absent. A cursor
SHALL continue only a request with the same account set.

#### Scenario: Malformed account set

- **WHEN** a client lists with `accounts` that is not an array, or names an
  origin that is not an HTTPS origin
- **THEN** the request is refused as invalid

#### Scenario: Settings still apply

- **WHEN** the Gitea source is set to list only repositories of open projects
  and a client lists with accounts set to the Gitea account
- **THEN** only open projects' repositories on that account are asked

#### Scenario: Cursor from another account set

- **WHEN** a client continues a list with a cursor issued for a different
  account set
- **THEN** the request is refused as invalid and the client is told to refresh
