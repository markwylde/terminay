import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { defineExtension } from '@terminay/extension-api';
import { createGiteaProbe } from './probe.js';
import { createGiteaInsightRuntime } from './refresh.js';
import { createTeaTokenStore, teaConfigPath } from './teaConfig.js';

export const EXTENSION_ID = 'com.terminay.gitea';
export const INSIGHT_SOURCE_ID = 'com.terminay.gitea/gitea';

export {
	checkState,
	matchPullRequest,
	toChecks,
	toProperties,
	toPullRequest,
} from './mapping.js';
export type { FetchLike, GiteaProbe } from './probe.js';
export { createGiteaProbe } from './probe.js';
export type { Clock, GiteaRuntimeOptions } from './refresh.js';
export {
	createGiteaInsightRuntime,
	FAILURE_BACKOFF_MS,
	ACTIVE_REFRESH_INTERVAL_MS,
	INACTIVE_REFRESH_INTERVAL_MS,
	refreshIntervalFor,
} from './refresh.js';
export type { ForgeRepository } from './remote.js';
export { parseRemoteUrl, pickRemote } from './remote.js';
export type { TeaLogin, TeaTokenStore } from './teaConfig.js';
export {
	createTeaTokenStore,
	parseTeaLogins,
	teaConfigPath,
} from './teaConfig.js';

export default defineExtension({
	activate(context) {
		const tea = createTeaTokenStore({
			path: teaConfigPath({
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
		});
		context.subscriptions.add({ dispose: () => tea.dispose() });
		context.subscriptions.add(
			context.worktrees.registerInsightSource(
				INSIGHT_SOURCE_ID,
				createGiteaInsightRuntime({
					fetch: (input, init) => fetch(input, init),
					probe: createGiteaProbe({
						fetch: (input, init) => fetch(input, init),
					}),
					tea,
				}),
			),
		);
	},
});
