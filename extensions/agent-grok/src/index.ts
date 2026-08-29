import { defineExtension } from "@terminay/extension-api";
import { PROVIDER_ID } from "./constants.js";
import { grokAgentProvider } from "./provider.js";

export { EXTENSION_ID, MAPPING_VERSION, PROVIDER_ID, SESSION_TITLE_RECORD } from "./constants.js";
export {
  createGrokRecordMapper,
  effectiveGrokHome,
  grokAgentProvider,
  isGrokForeground,
  mapGrokRecord,
} from "./provider.js";

export default defineExtension({
  activate(context) {
    context.subscriptions.add(context.agents.registerProvider(PROVIDER_ID, grokAgentProvider));
  },
});
