## Context

App windows (`terminal-app-windows`, ADR-0037, ADR-0038) let an agent show HTML in its terminal and hear back through `window.terminay.sendMessage`, which pastes up to 16 KiB of text into the PTY. Two limits showed up as soon as a window was reused as a questionnaire:

- The reply is text only. A person on a phone who wants to answer with a photo cannot.
- `show_window` takes the document inline, so an agent that reuses one design writes several kilobytes of identical HTML on every call.

The owner decided the shape of both in a questionnaire on 2026-10-07: the document may come from a file read by the local adapter and never by the server; files travel as attachments on `sendMessage`, not through a separate call; attachments have no size cap but a large one is warned about; attached files are not deleted when the terminal session ends.

Constraints from in-force ADRs: the view is untrusted and sandboxed (ADR-0038, ADR-0011); writing to a PTY and to disk is server authority (ADR-0017); a client never chooses an absolute path (ADR-0023); nothing is paced by a timer (ADR-0028); new behaviour is a negotiated capability in one bundle (ADR-0018); MCP authority is capability scope combined with the user's permission policy (ADR-0031).

## Goals / Non-Goals

**Goals:**

- A person can attach any file to a window message with one tap and no second step.
- An agent can show a saved document with fresh content by sending a path and a small JSON value.
- No new way for an agent to read files, and no way for a view to choose where bytes land.

**Non-Goals:**

- Attachments or `data` for MCP App views from connected servers. Their contract is SEP-1865, and its content blocks are a separate piece of work.
- Named, server-stored templates. A file on disk already persists across sessions and needs no new store.
- Giving a view the bytes of a file on disk, or any read access to attachments after they are sent.
- Cleaning up the scratch directory. The owner chose to leave files in place.
- Sending files from the agent to the view. `data` and `https` already cover that.

## Decisions

### 1. The adapter reads `html_file`; the server never sees a path

`apps/terminay-server/src/mcp/stdio.ts` is spawned by the agent CLI, runs as the agent's user, and inherits whatever OS sandbox the CLI applies to its children. It reads the named file (regular file via `lstat` then `open` with `O_NOFOLLOW` semantics on the final component, at most 512 KiB, valid UTF-8) and sends the contents as `html` on the existing control request. The server-side operation is unchanged apart from `data`.

*Boundary crossed:* the MCP tool surface, which until now performed no file read (`mcp-server`, "MCP security and privacy boundaries"). The read gives the agent nothing it lacks: the contents go to the user's window and are never in a tool result.

*Why not have the server read it:* the server would be opening a path chosen by an MCP caller, outside any project root, which is the client-chosen-path failure ADR-0011 and ADR-0020 exist to prevent. It would also be wrong on a remote server whenever the adapter and server disagree about the filesystem.

*Why not server-stored templates:* they need a store, a lifetime, a bound, and two more tools, and they do not survive a server restart unless persisted. A file already does all of that.

*Alternative considered, relative paths:* refused. The adapter's working directory is the CLI's and is not obvious to the agent; an absolute path is unambiguous.

### 2. `data` is embedded as inert JSON ahead of the author's script

The workspace already builds the view document and prepends the bootstrap (`viewDocument.ts`). It adds the window's data as a `<script type="application/json">` block, with `<`, `>`, `&`, U+2028 and U+2029 written as `\u` escapes so the block cannot be closed from inside. The bootstrap parses it once, deep-freezes it, and defines `window.terminay.data`.

*Why not deliver it in the `ui/initialize` result:* that arrives asynchronously, after the author's inline scripts have run, so every document would need to wait for it. A static block is there synchronously.

*Boundary:* data is untrusted input from the agent to an untrusted view. The only rule that matters is that the host never interprets it, which the escaping guarantees.

### 3. Attachments ride on the message

`sendMessage(text, { files })` is one request from the view. The alternative, a separate `sendFile` that returns a path the view then puts in its text, was rejected for three reasons: an upload would exist without a message, so it would need its own gesture rule, lease check, policy, and cleanup; the view would learn an absolute server path, which discloses the home directory and user name to untrusted content; and a view could upload and never send, filling the disk silently.

Order of checks, all before any byte leaves the client: capability, gesture (from the proxy's user-activation record, as today), window open, count at most 16, large-total confirmation, then the server's lease check and Window Messages policy. Only then does the upload start.

### 4. A new named scratch write, modelled on ADR-0023

The server writes attachments under `terminay-attachments` in `os.tmpdir()`, mode `0600`, in a directory of mode `0700`, with the name `<16 random hex>-<sanitised offered name>`. The offered name is reduced to `[A-Za-z0-9._-]`, truncated to 80 characters, and keeps its extension so tools recognise the type. The operation takes bytes and an offered name and nothing else.

ADR-0023 says the bound of a scratch write lives on the command and that a later feature does not inherit a general temporary-directory write. This is a second named write with its own rule, and it differs from the clipboard one in having no size or type limit, which is why it gets its own ADR.

*Boundary crossed:* untrusted view bytes reach the server's disk. The server never reads them back, never executes them, and never lets the client influence the path.

### 5. No size limit; streamed, acknowledged, and confirmed when large

The owner asked for no cap and a warning. The mechanism that makes "no cap" safe is streaming: the bootstrap slices each `File` into 256 KiB parts and transfers each `ArrayBuffer` to the workspace, which sends it as a binary-bodied request (the path view requests already use) and waits for the server's acknowledgement before asking the view for the next part. The server appends each part to the open file. Memory use is one part at each hop regardless of file size.

Above 8 MiB in total, `AppWindowHost` shows a confirmation in the window frame, outside the sandboxed view, with the file count and total size. During upload the frame shows progress and a cancel control.

*Why 8 MiB:* a phone photo is 2–6 MiB and should not prompt; a video or an archive should.

*Why the frame and not the view:* a view is untrusted and could draw a fake confirmation or skip a real one.

*Why a count bound of 16 when the owner declined a cap:* the declined cap was on size. A count bound keeps the approval prompt and the pasted message bounded, as every MCP surface must be. It is listed under Open Questions in case it is unwanted.

### 6. The server composes the pasted message

The text typed is the view's text, a line break, then `Attached: <absolute path>` per file. Paths contain only the temporary directory and the sanitised name, so they hold no control characters and need no quoting. The existing 16 KiB bound and the control-character rule apply to the view's text only. In a terminal without bracketed paste the line breaks become spaces, as they do for any window message.

The delivery result returned to the view is the existing empty success. The bridge strips nothing because the server never sends paths to the client holding the view.

### 7. Files are left in place

Nothing is removed on delivery, window close, or session end. Only an upload that did not complete is removed, since a partial file is useless and was never announced. This matches ADR-0023's acceptance of scratch files until the operating system's cleaner runs.

### 8. Capability `app-window-attachments.v1`

Negotiated per connection (ADR-0018). The workspace passes its availability to the bootstrap, which sets `window.terminay.attachments` and rejects a `files` argument locally when it is false. `html_file` and `data` need no capability: `html_file` is adapter-local, and a server that does not know `data` rejects the unknown field, which the adapter reports as an ordinary bounded error.

## Risks / Trade-offs

- **An agent uses `html_file` to put a file it is not allowed to read on screen** → the contents reach the user, who owns the file, and not the agent. The adapter also runs inside the CLI's own sandbox where one exists. A document cannot be both chosen by path and scripted by the agent, since `html` and `html_file` are exclusive, so the agent cannot add script that reads the file back through model context.
- **A file named by `html_file` contains script the agent did not write** → it runs in the same sandbox as any agent-authored view, with no more authority.
- **Unlimited attachments fill the disk** → every upload needs a gesture, uploads over 8 MiB need an explicit confirmation naming the size, the person can cancel, and a write failure removes the partial file and types nothing. The remaining exposure is a person repeatedly confirming large uploads, which is their choice.
- **Files accumulate because nothing removes them** → accepted by the owner. Platforms differ: Linux and macOS clear temporary directories periodically; a long-running container may not. Recorded in the operator runbook.
- **The opaque-origin frame may not be able to transfer `ArrayBuffer`s through the proxy** → task 1.1 measures it on Desktop and in a browser before other work. Fallback: structured-clone copy, which costs one extra copy of a 256 KiB part and nothing else.
- **A slow remote link makes a large upload take minutes** → progress and cancel are in the frame, and the terminal stays usable since the window is not modal.
- **Two unarchived changes modify the same `mcp-server` requirement** → this change must be archived after `terminal-app-windows`; stated in the proposal.

## Migration Plan

Additive. `sendMessage(text)` and `show_window` with `html` are unchanged. A newer workspace against an older server reports attachments unavailable. Rollback is removing the capability; files already written stay where they are.

## Open Questions

- Is the bound of 16 attachments per message wanted, given the owner declined a cap on size?
- Should Settings show how much the scratch directory holds, with a button to clear it? Left out because the owner chose not to clean up; cheap to add later.
- No in-force ADR needs revisiting. ADR-0023's scratch pattern is reused under a new ADR, not changed.
