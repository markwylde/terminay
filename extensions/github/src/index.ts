import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { defineExtension } from '@terminay/extension-api';
import { createGitHubForgeSource } from './forge.js';
import { createGhTokenCommand } from './ghCommand.js';
import { createCliTokenStore, ghHostsPath } from './ghConfig.js';
import { createGitHubProbe } from './probe.js';
import { createGitHubInsightRuntime } from './refresh.js';

export const EXTENSION_ID = 'com.terminay.github';
export const INSIGHT_SOURCE_ID = 'com.terminay.github/github';
export const FORGE_SOURCE_ID = 'com.terminay.github/forge';

export type { GitHubForgeOptions } from './forge.js';
export { createGitHubForgeSource, RateLimitedError, searchString } from './forge.js';

export type { CliTokenStore, GhHost, GhTokenCommand } from './ghConfig.js';
export {
	createCliTokenStore,
	environmentToken,
	ghHostsPath,
	parseGhHosts,
} from './ghConfig.js';
export {
	checkRunState,
	matchPullRequest,
	statusState,
	toChecks,
	toProperties,
	toPullRequest,
} from './mapping.js';
export type { FetchLike, GitHubProbe } from './probe.js';
export { createGitHubProbe } from './probe.js';
export { buildQuery, chunkBranches, MAX_BRANCHES_PER_QUERY } from './query.js';
export type { Clock, GitHubRuntimeOptions } from './refresh.js';
export {
	ACTIVE_REFRESH_INTERVAL_MS,
	createGitHubInsightRuntime,
	FAILURE_BACKOFF_MS,
	INACTIVE_REFRESH_INTERVAL_MS,
	refreshIntervalFor,
} from './refresh.js';
export type { ForgeRepository } from './remote.js';
export {
	graphqlEndpoint,
	parseRemoteUrl,
	pickRemote,
	tokenPageUrl,
} from './remote.js';

export default defineExtension({
	activate(context) {
		const cli = createCliTokenStore({
			env: process.env,
			path: ghHostsPath({
				env: process.env,
				platform: process.platform,
				home: homedir(),
			}),
			readFile: (path) => readFile(path, 'utf8'),
			watch: (path, onChange) => {
				const watcher = watch(path, { persistent: false }, onChange);
				watcher.on('error', () => watcher.close());
				return watcher;
			},
			ghToken: createGhTokenCommand({
				env: process.env,
				platform: process.platform,
			}),
		});
		context.subscriptions.add({ dispose: () => cli.dispose() });
		const probe = createGitHubProbe({
			fetch: (input, init) => fetch(input, init),
		});
		context.subscriptions.add(
			context.worktrees.registerInsightSource(
				INSIGHT_SOURCE_ID,
				createGitHubInsightRuntime({
					fetch: (input, init) => fetch(input, init),
					probe,
					cli,
				}),
			),
		);
		// Pull requests and issues, asked for on demand (ADR-0106).
		const forges = context.forges;
		const source = createGitHubForgeSource({
			fetch: (input, init) => fetch(input, init),
			probe,
			cli,
			credentials: forges.credentials,
		});
		const registration = forges.registerSource(FORGE_SOURCE_ID, source);
		context.subscriptions.add(registration);
		context.subscriptions.add(
			forges.credentials.onAvailable((origin) => {
				source.knownOrigins.add(origin);
				registration.invalidate(origin);
			}),
		);
	},
});
