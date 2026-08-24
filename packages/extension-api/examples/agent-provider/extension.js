import { defineExtension } from "@terminay/extension-api";
import { exampleAgentProvider } from "./example-agent.js";

export default defineExtension({
  activate(context) {
    const registration = context.agents.registerProvider(
      "com.example.agent/cli",
      exampleAgentProvider,
    );
    context.subscriptions.add(registration);
  },
});
