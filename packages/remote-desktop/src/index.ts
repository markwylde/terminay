/**
 * What both halves of a remote desktop agree on. The halves themselves are the
 * `./server`, `./client`, `./ui`, and `./session` entry points.
 */

/** Whether a stream may send input to the desktop. */
export type DesktopMode = 'view-only' | 'control';
