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
    extensionId: "dev.terminay.ssh",
    packageName: "terminay-plugin-ssh",
    displayName: "SSH",
    description: "Open Terminay projects on SSH servers.",
    publisher: "Terminay",
    official: true,
  }),
  Object.freeze({
    extensionId: "dev.terminay.puzed",
    packageName: "terminay-plugin-puzed",
    displayName: "Puzed Platform",
    description: "Create and open Terminay projects on Puzed virtual machines.",
    publisher: "Terminay",
    official: true,
  }),
]);

