## MODIFIED Requirements

### Requirement: Bounded transparent HTTP transport
The proxy SHALL preserve API versions, query strings, status codes, response headers, binary data, streaming requests/responses, Docker HTTP upgrades, terminal input/output and backpressure. The proxy SHALL forward each response's status and headers to the client as soon as the engine sends them, without waiting for the response body. Creation JSON SHALL be validated and bounded to 2 MiB before forwarding; invalid, compressed or oversized creation bodies SHALL fail without reaching the engine. Connections, outstanding requests, header sizes and finite input deadlines SHALL be bounded. Credentials and bodies SHALL not be logged. Shutdown SHALL close upstream requests, upgraded streams and the owned socket.

#### Scenario: Build, logs and interactive exec
- **WHEN** a client uploads a build context, follows logs or attaches an interactive exec
- **THEN** traffic streams without whole-body buffering and interactive input and output remain usable

#### Scenario: Attached run
- **WHEN** a user or agent in a bot runs `docker run --rm alpine echo ok` or `docker start --attach` on a created container
- **THEN** the client receives the engine's container-wait response headers before the container starts, the container starts, and the command prints its output and exits

#### Scenario: Quiet stream
- **WHEN** a client opens an event stream or follows logs and the engine has sent headers but no data yet
- **THEN** the client receives the response status and headers without waiting for the first event or log line

#### Scenario: Engine fails after sending headers
- **WHEN** the engine sends a response's headers and then drops the connection before the body is complete
- **THEN** the client receives that status and headers followed by a truncated response and a closed connection, not a hang or a second error response
