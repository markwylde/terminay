export interface OfficialExtensionCatalogueRecord {
  readonly extensionId: string;
  readonly packageName: string;
  readonly displayName: string;
  readonly description: string;
  readonly publisher: "Terminay";
  readonly official: true;
}

/** Catalogue membership is presentation metadata, never extra runtime authority. */
export const OFFICIAL_EXTENSION_CATALOGUE: readonly OfficialExtensionCatalogueRecord[] = Object.freeze([
  Object.freeze({
    extensionId: "com.terminay.ssh",
    packageName: "terminay-plugin-ssh",
    displayName: "SSH",
    description: "Open Terminay projects on SSH servers.",
    publisher: "Terminay",
    official: true,
  }),
  Object.freeze({
    extensionId: "com.puzed.platform",
    packageName: "terminay-plugin-puzed",
    displayName: "Puzed Platform",
    description: "Create and open Terminay projects on Puzed virtual machines.",
    publisher: "Terminay",
    official: true,
  }),
  Object.freeze({
    extensionId: "com.terminay.agent.codex",
    packageName: "terminay-agent-codex",
    displayName: "Codex",
    description: "Show Codex CLI sessions in the Agents sidebar.",
    publisher: "Terminay",
    official: true,
  }),
  Object.freeze({
    extensionId: "com.terminay.agent.claude-code",
    packageName: "terminay-agent-claude-code",
    displayName: "Claude Code",
    description: "Show Claude Code sessions in the Agents sidebar.",
    publisher: "Terminay",
    official: true,
  }),
  Object.freeze({
    extensionId: "com.terminay.agent.cursor",
    packageName: "terminay-agent-cursor",
    displayName: "Cursor Agent",
    description: "Show Cursor Agent CLI sessions in the Agents sidebar.",
    publisher: "Terminay",
    official: true,
  }),
  Object.freeze({
    extensionId: "com.terminay.agent.omp",
    packageName: "terminay-agent-omp",
    displayName: "omp",
    description: "Show omp sessions in the Agents sidebar.",
    publisher: "Terminay",
    official: true,
  }),
]);
