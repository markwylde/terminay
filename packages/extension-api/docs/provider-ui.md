# Provider and declarative UI guide

The renderer owns every component. Providers return bounded forms, status
cards, actions, confirmations, and progress models. Text is rendered as text;
there is no raw HTML/CSS/SVG/script/iframe/component escape hatch.

Use sections to keep creation forms progressive: essential fields expanded,
advanced placement/network fields collapsed. Field ids are stable persistence
keys. Secret fields create host-owned vault bindings and are never echoed back.
Async select sources must support cancellation, bounded queries/results,
deadlines, pagination cursors, and disabled reasons. Use preset cards only for a
small fixed choice. Return field-specific validation plus a summary-friendly
message.

Progress stage ids must remain stable across restart and resume. Report facts
that help the user act, without raw provider bodies or credentials. Destructive
actions require a destructive confirmation and the current expected revision.
HTTPS links are credential-free and guarded by the client.

Provider capabilities are honest routing claims. Declare only services that the
runtime implements. `terminal` and `filesystem` must preserve project/window,
terminal-session, environment, root-confinement, cancellation, and reconnect
boundaries. Never fall back to the Terminay Server filesystem or PTY when a
remote provider is unavailable. `filesystem-observation`, Git, process status,
agent journal, MCP bridge, and shell discovery are separate capabilities rather
than implications of terminal access.

The example provider is intentionally inert but complete enough to demonstrate
registration, form validation, resumable shapes, status, and lifecycle action
handling. Production providers should add contract tests for every callback,
host cancellation, deadline expiry, retries, redaction, hostile DTO rejection,
and packed activation.
