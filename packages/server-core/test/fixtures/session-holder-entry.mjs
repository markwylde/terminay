// A real session holder process for integration tests: the production entry
// points differ only in where they load node-pty from.
import * as nodePty from "node-pty";
import { runSessionHolderProcess } from "../../dist/index.js";

await runSessionHolderProcess(nodePty);
