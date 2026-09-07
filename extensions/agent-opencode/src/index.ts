import { defineExtension } from '@terminay/extension-api';
import { openCodeProvider, PROVIDER_ID } from './provider.js';

export { emptyState, mapOpenCodeEvent } from './mapping.js';
export {
	createOpenCodeRecordMapper,
	openCodeContinues,
	openCodeProvider,
	openCodeSessionId,
	openCodeWorkingDirectories,
	PROVIDER_ID,
	ROOT_SELECTION,
	selectOpenCodeRoot,
	storeWatcher,
	terminalDeviceKey,
} from './provider.js';
export {
	effectiveOpenCodeRoot,
	isOpenCodeForeground,
	OpenCodeStore,
	safeStorePath,
	storePathFor,
} from './store.js';

export default defineExtension({
	activate(context) {
		context.subscriptions.add(
			context.agents.registerProvider(PROVIDER_ID, openCodeProvider),
		);
	},
});
