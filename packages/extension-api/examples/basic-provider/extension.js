import { defineExtension } from "@terminay/extension-api";

const status = { state: "available", message: "Example is ready", defaultRoot: "/workspace", revision: 1 };

export default defineExtension({
  activate(context) {
    context.registerProjectEnvironmentProvider({
      definition: {
        providerId: "dev.example.basic/server",
        displayName: "Example server",
        capabilities: ["infrastructure"],
        createForm: {
          id: "dev.example.basic/create",
          title: "Create example environment",
          sections: [{ id: "connection", title: "Connection", fields: [{ id: "root", type: "text", label: "Default root", required: true }] }],
          submitLabel: "Create",
        },
      },
      runtime: {
        async testProfile() { return []; },
        async resolveOptions() { return { options: [] }; },
        async createEnvironment(request) { return { state: "ready", providerState: { root: request.values.root ?? "/workspace" }, status }; },
        async resumeOperation(request) { return { state: "ready", providerState: request.providerState, status }; },
        async getStatus() { return status; },
        async invokeAction(request) { return { state: "complete", providerState: request.providerState, status }; },
      },
    });
  },
});
