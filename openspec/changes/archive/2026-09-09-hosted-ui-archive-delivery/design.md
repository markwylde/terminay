## Context

Measured against a real containerised server paired with a real browser: ICE
connected, every channel opened, the device was approved, and the workspace was
a single sentence of unstyled text. That text is `createMinimalUiArchive()` in
`hostedPairingHost.ts`, the fallback used when `getUiArchive` is absent.

Two defects, one masking the other.

**The variable names do not match.** `cli.ts` reads the renderer directory
directly from `process.env.TERMINAY_UI_RENDERER_DIRECTORY`; the daemon CLI
writes `TERMINAY_UI_BUNDLE`. The latter is a real option, parsed in
`cliOptions.ts` and used for the local HTTP UI — which is why the mistake
survived review, and why `--status` reports `uiBundleConfigured: true` on a
server that cannot serve a workspace.

**The archive stages the wrong bundle.** Two UI bundles are built:

| Bundle | Built by | Entry | Consumer |
| --- | --- | --- | --- |
| `dist-web` | `vite.server-ui.config.ts` | `server.html` | the server-served workspace |
| `dist` | `vite.config.ts` | `remote.html` | the Desktop renderer |

`electron/main.ts` passes `dist-web` as its `rendererDirectory`. The archive
builder defaults `--ui-bundle` to `dist`, and the release workflow passes no
override, so `ui/` ships `remote.html`. `loadHostedUiArchive` looks for
`server.html` and throws.

So setting the correct variable on a released archive does not fix it — the
server exits at startup instead. Both defects have to go together, which is why
they are one change.

## Goals / Non-Goals

**Goals:**
- A device paired with a CLI-installed server receives that server's workspace.
- An artifact that cannot serve a workspace cannot be built or published.

**Non-Goals:**
- Changing the archive format, the transfer, or the client.
- Merging the two UI bundles. They have different entries and different
  consumers; this change picks the right one rather than reconciling them.
- Removing the placeholder archive. It remains correct for a server with no
  renderer directory configured at all — what changes is that an exposed server
  says so rather than quietly serving it.

## Decisions

### D1. Write both variables rather than renaming either

The CLI writes `TERMINAY_UI_RENDERER_DIRECTORY` alongside `TERMINAY_UI_BUNDLE`,
both pointing at `<prefix>/current/ui`.

Renaming the server's variable to match what the CLI already wrote was the
alternative, and it is worse: `TERMINAY_UI_BUNDLE` is a documented option with
a `--ui-bundle` flag serving the local HTTP UI, and collapsing two settings
into one name would make it impossible to configure them separately — which a
server serving a different local UI than it ships to devices would need.

They share a value today because one directory satisfies both. That is a fact
about the archive layout, not about the settings.

### D2. Stage `dist-web`, and prove it at build time

The builder's `--ui-bundle` default becomes `dist-web`, and the release job
builds that bundle before staging it.

A default alone would not have prevented this: the release passed no override
and inherited a wrong default silently. So the builder also asserts the staged
tree contains the hosted entry, and fails naming it. The probe asserts the same
against an already-built archive, because the builder can be right while a
later staging step drops the file.

This is the check whose absence let a broken artifact ship: nothing compared
what the archive carried against what the server would ask for.

### D3. An exposed server with no renderer directory fails loudly

Today it serves the placeholder. A device then pairs, connects, and shows a
sentence — indistinguishable, from the device, from a transport fault.

The server is the only party that knows its renderer directory is unset, so it
is the party that must say so. The placeholder stays for the case it was
written for: a server with no UI to serve at all, which is a legitimate
configuration for a headless protocol-only deployment, not for one an
administrator exposed.

### D4. Upgrade repairs an existing install

`daemon upgrade` adds the renderer directory when the environment lacks it,
using the same single-variable edit the advertised address uses. Without that,
every server installed before this change stays broken until someone reinstalls
it, and the symptom gives no hint that reinstalling is the remedy.

## Risks / Trade-offs

- [Staging `dist-web` changes what the local UI server serves] → it reads
  `manifest.json` for its entry rather than assuming a filename, and `dist-web`
  ships its own manifest, so both consumers are satisfied by one directory.
- [The archive grows or shrinks] → `dist-web` is the workspace UI rather than
  the Desktop renderer; the probe asserts what the archive must contain rather
  than its size.
- [Failing an exposed server with no renderer directory breaks a deployment
  that relied on the placeholder] → nothing can have relied on it deliberately:
  it renders one sentence and no workspace. A protocol-only deployment does not
  expose itself.

## Migration Plan

Servers installed by an earlier CLI are repaired by `daemon upgrade`, which
adds the missing variable. A reinstall also works. No data root, device
registry, or host key is touched.

## Open Questions

- None. Whether the two UI bundles should converge is a larger question about
  the Desktop and server entries, and this change deliberately does not answer
  it.
