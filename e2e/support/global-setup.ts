import { prebundleSharedWebShellDependencies } from './shared-web-shell-fixture';

/** Runs once per Playwright invocation, before any shard's first test. */
export default async function globalSetup(): Promise<void> {
	await prebundleSharedWebShellDependencies();
}
