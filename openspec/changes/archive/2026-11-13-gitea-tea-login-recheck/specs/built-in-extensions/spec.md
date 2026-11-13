## MODIFIED Requirements

### Requirement: Gitea credentials come from tea or sign-in

For a Gitea origin, `terminay-gitea` SHALL use, in order, a token from a `tea`
login whose URL matches the origin, read from the `tea` configuration file and
held only in memory, then a token stored for the origin through sign-in. It
SHALL NOT run the `tea` executable. With neither, it SHALL request sign-in for
the origin with a token-page link to `<origin>/user/settings/applications`. When
the origin rejects a token with 401, the extension SHALL stop using it and, for a
stored token, report it rejected.

The extension SHALL pick up a `tea` configuration file that is created, changed,
or replaced while it runs, without being restarted. A read that fails, including
because the file does not exist, SHALL NOT be remembered: the next credential or
account lookup SHALL read the file again. A `tea` token the origin rejected SHALL
stay unused until the configuration file changes.

#### Scenario: tea login present

- **WHEN** the `tea` configuration has a login for the origin
- **THEN** the extension uses that token without requesting sign-in and without
  running `tea`

#### Scenario: No credential

- **WHEN** neither a `tea` login nor a stored token exists for the origin
- **THEN** the extension requests sign-in for the origin

#### Scenario: Token revoked

- **WHEN** the origin answers 401 to the stored token
- **THEN** the extension reports the credential rejected and requests sign-in
  again

#### Scenario: tea signed in after the extension started

- **WHEN** the `tea` configuration file did not exist when the extension
  started, and the user then runs `tea login` and chooses **Check again** in the
  Gitea extension's Settings
- **THEN** the account from that `tea` login is listed without restarting the
  extension

#### Scenario: tea configuration replaced

- **WHEN** the `tea` configuration file is deleted and later written again, or
  replaced by renaming a new file over it, with a different login
- **THEN** the extension uses the new login's token on its next lookup, and
  picks up later edits to that file too

#### Scenario: New tea token after a rejection

- **WHEN** the origin answered 401 to a `tea` token, and `tea login` then writes
  a new token for that origin to the configuration file
- **THEN** the extension uses the new token on its next lookup, while an
  unchanged file never offers the rejected token again
