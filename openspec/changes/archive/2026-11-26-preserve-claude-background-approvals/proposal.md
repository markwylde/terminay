## Why

A Claude bot can stop making progress after starting a background job, then fail to report the blockage in chat. Rainy's session showed a green check despite failed file edits and a failed blocker report. A local reproduction with the same Claude version isolated the host approval stream closing on the first result while background work continued.

## What Changes

- Keep the host approval channel available when Claude reports a result while background work is active, including for follow-up writes and runtime chat tools.
- Record a Claude host approval stream failure as an execution failure even when Claude exits cleanly.

## Capabilities

### New Capabilities

### Modified Capabilities

- `terminay-bots` covers approvals after background wake-ups and execution status when the approval stream breaks.

## Impact

The server-side Claude Code bot adapter and its tests change. Bot chat continues to use the existing runtime tools and authority checks.
