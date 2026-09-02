# Task 19 locally emulated mobile-Chromium MCP control evidence

This is deterministic touch-enabled Chromium evidence at a `390 × 820`
viewport, not physical-device or externally hosted execution.

`McpServerControlClient` is the shared query/command boundary for bounded MCP
server projections and acknowledged control mutations. Its focused contract
rejects unsafe server projections and acknowledgements whose server identity
does not match the requested mutation.

The rendered workflow in `e2e/shared-production-routes.spec.ts`:

- lists stopped and failed MCP servers through `mcp.servers.list`;
- taps Start and accepts only the matching acknowledged running state;
- taps Retry for a failed server and renders the rejected command without
  falsely changing that server to running; and
- records the exact list/start/retry operation sequence.

Run:

```sh
npm run build --workspace @terminay/client-core
node --test packages/client-core/test/mcp-server-control.test.mjs
npx playwright test e2e/shared-production-routes.spec.ts \
  -g "touch-mobile Chromium lists and controls MCP servers"
```

This completes the reproducible mobile-web MCP control cell. Physical-mobile
and externally hosted execution remain operational follow-ups.
