// A holder from a future build: it speaks only a protocol version no current
// server knows. It holds one real shell so a test can see what becomes of it.
import * as nodePty from "node-pty";
import { SessionHolder } from "../../dist/index.js";

const holder = await SessionHolder.start({
  dataRoot: process.env.TEST_HOLDER_DATA_ROOT,
  generation: "ffffffffffffffff",
  buildId: "build-future",
  nodePty,
  limitMs: null,
  versions: [99],
  onClosed: () => process.exit(0),
});
process.on("SIGTERM", () => void holder.close("signal"));
