import type { ExtensionContext } from "../../dist/index.js";

type HasGlobalTerminay = typeof globalThis extends { terminay: unknown } ? true : false;
const noGlobal: HasGlobalTerminay = false;
void noGlobal;

export function activate(context: ExtensionContext): void {
  void context.agents.registerProvider;
}

// @ts-expect-error There is no global Terminay singleton an extension can reach for.
const denied = terminay;
void denied;
