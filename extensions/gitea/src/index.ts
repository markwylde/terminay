import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { defineExtension } from '@terminay/extension-api';
import { createGiteaForgeSource } from './forge.js';
import { createGiteaProbe } from './probe.js';
import { createGiteaInsightRuntime } from './refresh.js';
import { createTeaTokenStore, teaConfigPath } from './teaConfig.js';

export const EXTENSION_ID = 'com.terminay.gitea';
export const INSIGHT_SOURCE_ID = 'com.terminay.gitea/gitea';
export const FORGE_SOURCE_ID = 'com.terminay.gitea/forge';

export type { ForgeFetch, GiteaForgeOptions } from './forge.js';
export { createGiteaForgeSource, mergeStreams, searchStreams } from './forge.js';

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
				// A dead watch can't guard the cached logins; the store drops both.
				watcher.on('error', onChange);
				return watcher;
			},
		});
		context.subscriptions.add({ dispose: () => tea.dispose() });
		const probe = createGiteaProbe({
			fetch: (input, init) => fetch(input, init),
		});
		context.subscriptions.add(
			context.worktrees.registerInsightSource(
				INSIGHT_SOURCE_ID,
				createGiteaInsightRuntime({
					fetch: (input, init) => fetch(input, init),
					probe,
					tea,
				}),
			),
		);
		// Pull requests and issues, asked for on demand (ADR-0106).
		const forges = context.forges;
		const source = createGiteaForgeSource({
			fetch: (input, init) => fetch(input, init),
			probe,
			tea,
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
