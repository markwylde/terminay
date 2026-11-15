## Context

Home's Pull Requests and Issues sections (ADR-0106) ask the host forge service
for one merged, paged list. The service's `openStreams` asks each source that
serves the kind for its accounts, opens one stream per ready account, narrows
each by settings and the request's `repositories`, and merges the streams by
update time. A cursor names a server-side continuation whose `listKey` must
match the follow-up request; a mismatch is refused as "the list has expired".
Source pages are cached separately, keyed by source and query.

The renderer remembers scope, state, and grouping per section in
`localStorage` (`terminay.forge.<kind>.view.v1`), which is per device and per
client origin (ADR-0005). Accounts are listed by `forge.accounts` (unbound
clients only; Home is always unbound) as `{ sourceId, extensionId, accounts:
[{ origin, login, state, … }] }`; a source reports at most one account per
origin. The forge capability itself is still the unarchived
`forge-pull-requests-and-issues` change.

## Goals / Non-Goals

**Goals:**
- Let Home's two sections show one account's items, with correct paging,
  counts, and failure notes, remembered per section on the device.
- Keep the server the only place that decides which accounts are asked.

**Non-Goals:**
- A project's Git tab: it is already narrowed to the project's claimed
  repositories, which fixes the origin.
- Home's sidebar badge counts, which keep counting every account.
- Choosing several accounts at once in the UI (the protocol carries a set; the
  UI picks one or all).
- Visible feedback when `forge.accounts` itself fails: the control hides and the
  section lists every account, the behaviour before this change.

## Decisions

1. **Account identity is `{ sourceId, origin }`.** That pair is what the
   service streams and what Settings lists; a login alone is ambiguous across
   forges and hosts. The remembered value is that pair; the label (login · host
   · forge name) is derived from `forge.accounts` each time.

2. **Narrow on the server, not in the renderer.** `ForgeListRequest` gains
   `accounts?: { sourceId, origin }[]`. Filtering a merged page in the renderer
   was rejected: a page of 50 might hold three of the chosen account's items,
   the cursor would still walk every account, and outcomes would report
   failures for hidden accounts.
   *Boundary — client → server forge protocol, where the renderer is
   untrusted:*
   - The adapter copies `accounts` whenever the body has the key (any value),
     so `checkListRequest` sees and refuses `null`, objects, or bad entries;
     a malformed set is never dropped into "unfiltered".
   - `checkListRequest` requires an array of at most
     `EXTENSION_LIMITS.forgeQueryAccounts` (16, new) entries, each a non-empty
     string `sourceId` and an HTTPS origin.
   - `openStreams` skips a source whose id the set does not name *before*
     asking it for accounts, so a hidden source's discovery failure is not
     reported; then skips each account whose origin the set does not name for
     that source. Everything after that — project binding, settings,
     `repositories` — is unchanged, so the set only ever removes streams.
   - With a set present, `noAccounts` is false: an empty narrowed list is
     "no matches", not "no account set up".
   - `accounts` joins `listKey`, so a cursor continues only a request with the
     same set (the existing "expired; refresh" refusal otherwise). Source page
     caching is unchanged: All accounts and a single-account list asking the
     same account the same query may share that account's cached pages, which
     is correct because the pages are identical.

3. **Which accounts the control offers.** A `useForgeAccounts` hook asks
   `forge.accounts` on show and on `forge.changed`, with a request counter so an
   older answer never replaces a newer one. The section keeps ready accounts
   whose source serves its kind and has it on Home in its settings
   (`useForgeSources`). The control renders only with two or more, as a native
   `<select>` labelled **Account** after the Group control — it scales to any
   number of accounts and needs no new popover.

4. **Remembered with the other view preferences.** `ForgeViewPreferences` gains
   `account: { sourceId, origin } | null` (`null` = All accounts);
   `readPreferences` accepts only a well-formed value, so older stored values
   read as All accounts and the key stays `v1`. The *effective* account is:
   - `null` while a repository focus is active;
   - `null` when the offered accounts are known and fewer than two, or do not
     include the remembered one;
   - otherwise the remembered one — including before the first accounts
     answer, so a restored filter does not flash every account's items first.
   The remembered value is never rewritten by these rules, which gives "returns
   when the account comes back" for free.

5. **Focus and selection.** Choosing an account while focused clears the focus
   (the newest explicit choice wins) and is remembered. Choosing an account
   clears the detail selection when the selected item's `sourceId`/origin is not
   that account's.

6. **Filtered empty state.** With an effective account, an empty, failure-free,
   settled list reads "No <noun> for <login> on <host>." with **Show all
   accounts**. A failed outcome for that account takes precedence, as today.

## Risks / Trade-offs

- [The remembered account is applied before `forge.accounts` answers and may be
  gone] → one round trip returns an empty list, then the options arrive and
  the effective account becomes All accounts, which re-asks.
- [`forge.accounts` fails] → no options, control hidden, every account listed.
- [Server without this change ignores `accounts`] → the UI is server-bundled
  (ADR-0008), so client and server ship together.
- [This change and `forge-pull-requests-and-issues` both touch `forge-sources`
  and `pull-requests-and-issues`] → this change is archived after that one, so
  its ADDED requirements land on top of the forge capability's; its "Host forge
  service" requirement ("asks every source once per account") reads with the
  narrowing requirement here as the exception.
