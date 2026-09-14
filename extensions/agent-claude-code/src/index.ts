import { defineExtension } from '@terminay/extension-api';
import { claudeCodeProvider, PROVIDER_ID } from './provider.js';

export {
	createClaudeRecordMapper,
	isClaudeSessionStatus,
	mapClaudeRecord,
	SESSION_STATUS_RECORD_TYPE,
	sessionStatusRecord,
} from './mapping.js';
export {
	CLAUDE_SESSION_FILE_FIELDS,
	claudeCodeProvider,
	PROVIDER_ID,
} from './provider.js';
export {
	claudeProjectDirectoryPath,
	claudeProjectJournalPath,
} from './resume.js';

export default defineExtension({
	activate(context) {
		context.subscriptions.add(
			context.agents.registerProvider(PROVIDER_ID, claudeCodeProvider),
		);
	},
});
