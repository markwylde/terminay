import { defineExtension } from "@terminay/extension-api";
import { claudeCodeProvider, PROVIDER_ID } from "./provider.js";

export { claudeCodeProvider, PROVIDER_ID } from "./provider.js";
export { mapClaudeRecord } from "./mapping.js";
export { claudeProjectJournalPath, claudeResumeSessionId } from "./resume.js";

export default defineExtension({
  activate(context) {
    context.subscriptions.add(context.agents.registerProvider(PROVIDER_ID, claudeCodeProvider));
  },
});
