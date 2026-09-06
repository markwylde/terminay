import { defineExtension } from '@terminay/extension-api';
import { claudeCodeProvider, PROVIDER_ID } from './provider.js';

export { createClaudeRecordMapper, mapClaudeRecord } from './mapping.js';
export { claudeCodeProvider, PROVIDER_ID } from './provider.js';
export {
	INPUT_REQUEST_WINDOW_MS,
	MEASURED_IN_TURN_QUIET_CEILING_MS,
	QUIET_RECORD,
	withQuiescence,
} from './quiescence.js';
export {
	claudeProjectDirectoryPath,
	claudeProjectJournalPath,
	claudeResumeSessionId,
} from './resume.js';

export default defineExtension({
	activate(context) {
		context.subscriptions.add(
			context.agents.registerProvider(PROVIDER_ID, claudeCodeProvider),
		);
	},
});
