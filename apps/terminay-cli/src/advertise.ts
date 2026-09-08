/**
 * How many consecutive UDP ports an advertised address reserves.
 *
 * The WebRTC runtime gives every candidate its own socket from the pinned
 * range, so this is a budget as well as a promise: it is small enough to
 * publish in one `-p` range, and large enough for the advertised address plus a
 * couple of the server's own. It must match the span the server uses.
 */
export const ADVERTISED_PORT_SPAN = 4;
