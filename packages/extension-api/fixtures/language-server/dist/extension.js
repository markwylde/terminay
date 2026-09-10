import { fileURLToPath } from "node:url";
import { defineExtension } from "@terminay/extension-api";

const LANGUAGE_SERVER_ID = "fixture-language";
const stubServer = fileURLToPath(new URL("./stub-language-server.js", import.meta.url));

export default defineExtension({
  activate(context) {
    context.registerLanguageServerProvider({
      id: LANGUAGE_SERVER_ID,
      runtime: {
        async launch(request, signal) {
          if (signal.aborted) throw new Error("launch aborted");
          return {
            command: process.execPath,
            args: [stubServer],
            initializationOptions: { projectRoot: request.projectRoot },
            description: "stub language server",
          };
        },
      },
    });
  },
});
