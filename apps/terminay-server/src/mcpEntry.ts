import { runServerMcpStdio } from "./mcp/stdio.js";
import { assertStandaloneReleaseIntegrity } from "./releaseIntegrity.js";

await assertStandaloneReleaseIntegrity();

const socketPath = process.env.TERMINAY_CONTROL_SOCKET;
const token = process.env.TERMINAY_CONTROL_TOKEN ?? "";

runServerMcpStdio({ socketPath: socketPath ?? "", token }).catch((error: unknown) => {
  process.stderr.write(`terminay mcp failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
