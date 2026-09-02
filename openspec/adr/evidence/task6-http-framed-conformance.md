# Task 6 HTTP/framed conformance evidence

`apps/terminay-server/test/local-ui-framed-conformance.test.mjs` exercises one
shared operation registry through both protocol paths:

- authenticated local HTTP JSON query and command requests;
- an authenticated local HTTP protocol-frame command with raw binary bytes;
- a framed `ServerConnection` using the same query, command, and binary
  handlers.

The test compares the query result, command result and revision, and binary
payload result. This closes the transport-delegation evidence gap for the
representative operation set and does not permit local HTTP to use a smaller
operation body budget than framed transports. It does not claim that every
product feature operation or full browser/hosted pairing surface has parity;
those remain covered by the broader open Task 6 and Task 19 gates.
