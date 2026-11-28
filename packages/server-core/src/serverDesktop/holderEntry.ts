/**
 * The desktop holder's own process. A server starts it detached, with
 * `node <this file>`, and it outlives that server.
 */
import { runDesktopHolderProcess } from './holderProcess.js';

await runDesktopHolderProcess();
