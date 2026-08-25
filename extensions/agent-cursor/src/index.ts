import { defineExtension } from "@terminay/extension-api";
import { cursorAgentProvider } from "./cursorAgent.js";

export { createCursorAgentProvider, cursorAgentProvider, cursorModelDisplayName, cursorPromptText } from "./cursorAgent.js";

/** Entrypoint registered by the public Terminay extension host. */
export default defineExtension({
  activate(context) {
    const registration = context.agents.registerProvider(
      "com.terminay.agent.cursor/cli",
      cursorAgentProvider,
    );
    context.subscriptions.add(registration);
  },
});
