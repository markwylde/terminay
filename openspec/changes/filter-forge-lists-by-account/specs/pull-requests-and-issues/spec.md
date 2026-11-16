## ADDED Requirements

### Requirement: Home account control

Home **Pull Requests** and **Issues** SHALL each show an **Account** control
when two or more signed-in accounts (a forge source's login on one origin) serve
that section on Home. It SHALL offer **All accounts**, selected by default,
then each such account labelled with its login, host, and forge name. With
fewer than two, the control SHALL be hidden and every account's items listed.

#### Scenario: Two accounts connected

- **WHEN** a user has a Gitea account `alice` on `git.example.net` and a GitHub
  account `alice` on `github.com`, and opens Home › Pull Requests
- **THEN** the toolbar shows an Account control set to All accounts, offering
  All accounts, `alice` on `git.example.net` (Gitea), and `alice` on
  `github.com` (GitHub)

#### Scenario: One account

- **WHEN** only one signed-in account serves Home › Issues
- **THEN** the Issues toolbar has no Account control and Issues lists that
  account's items

### Requirement: Home lists filtered to the chosen account

Choosing an account SHALL list only that account's items; the section's count,
paging, and failure notes SHALL describe only that account. Choosing a
different account SHALL close a detail preview whose item is not that
account's. When the filter leaves the list empty and no failure is reported, the
empty state SHALL name the account and offer **Show all accounts**, which
selects All accounts. A failure of the chosen account SHALL be shown instead of
that empty state.

#### Scenario: Choosing one account

- **WHEN** the user chooses the `git.example.net` account
- **THEN** only pull requests from that account are listed, and no pull request
  from `github.com` appears

#### Scenario: Preview of another account's item

- **WHEN** a `github.com` pull request is open in the detail preview and the
  user chooses the `git.example.net` account
- **THEN** the detail preview closes

#### Scenario: Nothing for the chosen account

- **WHEN** the chosen account has no items for the selected scope and state
- **THEN** the empty state names the account and offers Show all accounts, and
  choosing it lists every account's items

### Requirement: Account choice remembered per section

The device SHALL remember the chosen account for each section separately,
beside that section's remembered scope, state, and grouping. A remembered
account that no longer serves the section SHALL be treated as All accounts while
it is absent, without being forgotten, so the section filters by it again when
it returns.

#### Scenario: Choice remembered per section

- **WHEN** the user chooses the `git.example.net` account in Pull Requests,
  leaves Issues on All accounts, and later reopens Home on the same device
- **THEN** Pull Requests is filtered to the `git.example.net` account and Issues
  lists every account

#### Scenario: Remembered account signed out and back in

- **WHEN** the remembered Pull Requests account is removed in Settings ›
  Extensions, and later added again
- **THEN** Pull Requests lists every remaining account while it is gone, and is
  filtered to it again once it is back

### Requirement: Repository focus overrides the account filter

While a Home section is focused on a repository because a project tab sent the
user there, the section SHALL list that repository across all accounts, and its
Account control SHALL show All accounts. Choosing an account during the focus
SHALL clear the focus and filter to that account. Clearing the focus SHALL
restore the remembered account. The focus SHALL NOT change the remembered
account.

#### Scenario: Focus from a project tab

- **WHEN** Pull Requests is filtered to the `github.com` account and a project
  tab sends the user to Home focused on a `git.example.net` repository
- **THEN** that repository's pull requests are listed and the Account control
  shows All accounts

#### Scenario: Focus cleared

- **WHEN** the user then clears the repository focus
- **THEN** Pull Requests is filtered to the `github.com` account again
