// Commits the browser-shell fixture's Vite dependency bundle into
// node_modules/.vite during the E2E image build, using the fixture's own
// configuration so every fixture server in the image starts warm.
import { prebundleSharedWebShellDependencies } from "../e2e/support/shared-web-shell-fixture.ts";

const started = Date.now();
await prebundleSharedWebShellDependencies();
process.stdout.write(
	`Pre-bundled browser-shell fixture dependencies in ${Date.now() - started}ms\n`,
);
