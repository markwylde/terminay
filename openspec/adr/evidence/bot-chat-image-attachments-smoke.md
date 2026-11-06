# Bot chat image attachments — native CLI smoke

Date: 2026-11-06
Change: `openspec/changes/bot-chat-image-attachments`

## What was tested

Each CLI ran with the argument and message shapes the Terminay server builds:

- **Claude Code:** `claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --model haiku`. One `user` message was written to stdin. Its `content` was a text block followed by one `{type:'image', source:{type:'base64', media_type, data}}` block per image, the shape `BotNativeClient.prompt` writes.
- **Codex:** `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --image <path>… -` with the prompt on stdin, the shape `nativeArguments('codex-cli', …, images)` emits.

Each CLI received four 64×64 solid-colour images, one per format, and then all four in one message. It was asked to name the dominant colour of each.

These runs were on the macOS host, not inside a bot container. The bot container uses the same CLIs and flags. Only the image paths differ: the server writes images to `/tmp/terminay-attachments/<executionId>/` inside the container, and that write is covered separately in the server unit tests.

## Results

| CLI | Version | red.png | green.jpg | blue.gif | yellow.webp | All four |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | 0.165.0 (the pinned bot-image version, via `npx`) | red | green | blue | yellow | red, green, blue, yellow |
| Claude Code | 2.1.319 (host install) | red | green | blue | yellow | red, green, blue, yellow |

Claude Code 2.1.312, the pinned bot-image version, could not be run through `npx`: the host npm `allowScripts` policy blocks its platform-binary postinstall. The host's 2.1.319 was used instead. The stream-json image content block is part of the stable input format of both versions.
