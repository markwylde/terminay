import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { defineExtension } from '@terminay/extension-api';
import { createGhTokenCommand } from './ghCommand.js';
import { createCliTokenStore, ghHostsPath } from './ghConfig.js';
import { createGitHubProbe } from './probe.js';
import { createGitHubInsightRuntime } from './refresh.js';

export const EXTENSION_ID = 'com.terminay.github';
export const INSIGHT_SOURCE_ID = 'com.terminay.github/github';

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
		context.subscriptions.add(
			context.worktrees.registerInsightSource(
				INSIGHT_SOURCE_ID,
				createGitHubInsightRuntime({
					fetch: (input, init) => fetch(input, init),
					probe: createGitHubProbe({
						fetch: (input, init) => fetch(input, init),
					}),
					cli,
				}),
			),
		);
	},
});
