import { defineExtension } from "@terminay/extension-api";
import { ompAgentProvider } from "./ompAgent.js";

/** Terminay entrypoint for the official oh-my-pi CLI provider. */
export default defineExtension({
  activate(context) {
    context.subscriptions.add(
      context.agents.registerProvider("com.terminay.agent.omp/cli", ompAgentProvider),
    );
  },
});

export { ompAgentProvider } from "./ompAgent.js";
export {
  OMP_TITLE_SLOT_BYTES,
  createOmpRecordMapper,
  extractOmpSessionHeader,
  isOmpForeground,
  ompJournalRelativeRoots,
  resolveLocalOmpJournalRoots,
} from "./ompAgent.js";
