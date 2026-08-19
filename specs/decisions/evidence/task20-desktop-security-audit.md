# Task 20 Desktop host security audit

This slice audits the current Desktop/server-UI host boundary. Every selected
server origin is rendered through the same isolated server-UI host rather than
a separate remote-content window. It is deliberately narrower than the parent
Task 20 security checkbox; packaged artifact review, dialog policy, and
primary-window platform review remain separate release gates.

Evidence: `scripts/task20-desktop-security-audit.test.mjs`.

- Server UI windows retain context isolation, disabled Node integration,
  sandboxing, web security, denied new windows, denied webviews, same-origin
  frame/navigation/redirect guards, and denied browser permissions.
- The server UI response path declares a self-only CSP with no objects or
  frame ancestors, a deny-by-default Permissions Policy, no-referrer policy,
  and MIME sniffing protection.
- The shared Desktop host shell allows navigation only for the selected
  connection origin and denies cross-origin navigation, credential/query
  navigation state, downloads, permissions, and unapproved new windows.
- Each server UI window receives an opaque host-derived isolated partition and
  a narrow server-UI preload bridge. It retains context isolation, disabled
  Node integration, sandboxing, web security, and no webviews; it denies new
  windows, frame/top-level navigation and redirects outside the selected
  server origin, downloads, and browser permissions, and removes its download
  handler when destroyed.
- Pairing deep links require HTTPS, reject credentials and query data, reject
  malformed/control-bearing fragments, and expose only the exact origin and
  non-secret path/length metadata to the profile layer.
- Clipboard actions are capability- and user-gesture-gated and bounded to
  1 MiB. External URL actions are capability- and user-gesture-gated, limited
  to canonical credential-free HTTP and HTTPS URLs, and reject control characters.

The external URL change also closes a concrete gap: HTTP and HTTPS URLs containing
`user:pass@host` are now rejected before they can reach the operating-system
URL handler.
