# Agent CLI Enter submission

Date: 2026-11-10. Claude Code 2.1.322 on macOS, driven over node-pty by
[`probe.cjs`](probe.cjs) with a 150-character plain-text message.

```sh
node openspec/adr/evidence/agent-cli-enter-submission/probe.cjs \
  "$PWD/node_modules/node-pty" <mode> <scratch dir> 50
```

| Mode | PTY writes | Result |
| --- | --- | --- |
| `joined` | `text\r` | not submitted: the `\r` becomes a newline in the prompt |
| `split` | `text`, then `\r` 50 ms later | submitted (4 of 4 runs) |
| `bracket-joined` | `ESC[200~text ESC[201~\r` | submitted |
| `bracket-split` | paste, then `\r` 50 ms later | submitted |
| `recover` | `text\r`, then `\r` 1 s later | submitted |

Earlier ad-hoc runs gave the same split results at 20 ms and 150 ms. In the
live incident, an empty bracketed paste and its `\r` in one write, sent to a
prompt already holding text, did not submit.

## Limits

A PTY write boundary is not a read boundary. A program that stalls for longer
than the pause can still read the text and the Enter together. The pause makes
the common case work. It is not a guarantee.
