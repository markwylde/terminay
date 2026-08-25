import { defineExtension } from "@terminay/extension-api";
import { PROVIDER_ID } from "./constants.js";
import { codexAgentProvider } from "./provider.js";

export { EXTENSION_ID, MAPPING_VERSION, PROVIDER_ID } from "./constants.js";
export { codexAgentProvider, effectiveCodexHome, mapCodexRecord } from "./provider.js";

export default defineExtension({
  activate(context) {
    context.subscriptions.add(context.agents.registerProvider(PROVIDER_ID, codexAgentProvider));
  },
});
