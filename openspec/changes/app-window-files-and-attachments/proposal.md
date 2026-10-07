## Why

A person answering a question in an app window cannot hand the agent a photo or a file: a window can only type text into its terminal, so a questionnaire that offers "attach a photo" has to tell the person to drop the photo into the chat afterwards. And an agent that reuses one window design, such as that questionnaire, must write the whole HTML document out again on every call, which is slow and costs output each time, even though the document already sits in a file beside the agent.

## What Changes

- `show_window` accepts **`html_file`**, the path of an HTML file, in place of `html`. The stdio adapter, which is the agent's own child process, reads the file and sends its contents as the document. The Terminay Server never opens the path, and the file's contents are never returned to the agent.
- `show_window` accepts **`data`**, a JSON value of at most 64 KiB, kept on the window record. An agent-authored view reads it as `window.terminay.data` before any of its own script runs. One saved document can therefore show different content on each call.
- `window.terminay.sendMessage(text, { files })` carries **attachments**. The server writes each file into a scratch directory it owns, chooses the file's name, and adds the resulting paths to the message it types into the terminal, so the agent can open them. The view never learns a path.
- Attachments ride on the message, so they are held to everything a window message already is: the user's gesture, the presentation lease, and the Window Messages policy. Under Ask Permission the prompt names each file and its size.
- An attachment has **no size limit**. It is streamed in parts so that neither the client nor the server holds a whole file in memory. When the attachments of one message total more than 8 MiB, the window frame asks the person to confirm, stating the size, before anything is uploaded.
- Attachments may be of **any type**. They are written as plain files the server never executes.
- Attached files are **not removed when the terminal session ends**. They stay until the operating system's temporary-file cleaner removes them, as clipboard images do (ADR-0023).
- A new negotiated capability, `app-window-attachments.v1`. Without it `window.terminay.attachments` is `false` and a message with files is refused before anything is sent.

Not changing:

- `sendMessage(text)` with no files behaves exactly as today, including the 16 KiB text bound and one message per time the window is open.
- View isolation (ADR-0038) and mirroring (ADR-0039). A view still has no filesystem access; it can only offer bytes the person picked.
- MCP App views from connected servers. Attachments and `data` are for agent-authored views.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-app-windows`: requirements are added for window data, for message attachments (delivery, naming, retention, streaming), and for the large-attachment confirmation.
- `mcp-server`: a requirement is added for `html_file` and `data` on `show_window`; the security-boundary requirement changes to name the one file read the adapter performs.
- `mcp-permissions`: a requirement is added so the Window Messages prompt names a message's attachments.

## Impact

- **Builds on** the `terminal-app-windows` change, which must be archived first: this change adds to capabilities it introduces and modifies the `mcp-server` boundary requirement as that change leaves it.
- `apps/terminay-server/src/mcp/stdio.ts`: `html_file` and `data` in the `show_window` schema and description; the file read, bounded to 512 KiB.
- `packages/server-core/src/appWindows/`: `data` on the window record; attachment upload operations, the scratch writer, and message composition.
- `packages/protocol`: capability `app-window-attachments.v1`.
- `packages/client-core/src/appWindows.ts`: attachment upload calls.
- `src/workspace/appWindows/`: `window.terminay.data` and the `files` option in the bootstrap (`viewDocument.ts`), attachment handling in `viewBridge.ts`, the confirmation and upload progress in `AppWindowHost.tsx`, attachment lines in `McpApprovalStrip`.
- `public/app-view.html`: the proxy must relay a message that carries bytes. If it already relays structured-clone payloads unchanged, it needs no change, and `terminay.com` needs none either; task 1.1 establishes which.
- Security: the server gains one more named scratch write of untrusted bytes, with no size or type limit. The adapter gains a read of a path the agent names.
- Disk: attached files accumulate in the temporary directory until the operating system clears it.
