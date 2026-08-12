#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertManifestMatchesPackage, validateExtensionManifest } from "./validation.js";

async function main(): Promise<void> {
  const packagePath = resolve(process.argv[2] ?? "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as unknown;
  if (typeof packageJson !== "object" || packageJson === null || !("terminay" in packageJson)) throw new Error("package.json must contain a terminay manifest");
  const result = validateExtensionManifest((packageJson as { terminay: unknown }).terminay);
  if (!result.ok) {
    for (const issue of result.issues) process.stderr.write(`${issue.path} [${issue.code}] ${issue.message}\n`);
    process.exitCode = 1;
    return;
  }
  assertManifestMatchesPackage(result.value, packageJson);
  process.stdout.write(`Valid Terminay extension: ${result.value.id}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Conformance failed"}\n`);
  process.exitCode = 1;
});
