import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// This is the tracked build context that can affect Dockerfile.e2e. Docker
// excludes .github, and Docker itself does not make the root Dockerfile
// available to COPY instructions, so neither should invalidate the E2E image.
const { stdout } = await run("git", [
	"ls-files",
	"-s",
	"--",
	".",
	":(exclude).github/**",
	":(exclude)Dockerfile",
]);

if (!stdout) throw new Error("the E2E Docker build context is empty");

process.stdout.write(
	createHash("sha256").update(stdout).digest("hex"),
);
