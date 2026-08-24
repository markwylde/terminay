#!/usr/bin/env node
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { verifyBuiltInExtensionArtifacts } from "./verify-built-in-extension-artifacts.mjs";

export async function copyBuiltInExtensionArtifacts(source, destination) {
  const checkedSource = resolve(source); const checkedDestination = resolve(destination);
  if (checkedSource === checkedDestination) throw new Error("built-in extension artifact copy source and destination must differ");
  await verifyBuiltInExtensionArtifacts(checkedSource);
  const next = `${checkedDestination}.next`;
  await rm(next, { recursive: true, force: true });
  try {
    await mkdir(dirname(checkedDestination), { recursive: true });
    await cp(checkedSource, next, { recursive: true, dereference: false, errorOnExist: true });
    await rm(checkedDestination, { recursive: true, force: true });
    await rename(next, checkedDestination);
  } catch (error) { await rm(next, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error("usage: copy-built-in-extension-artifacts.mjs <source> <destination>");
  await copyBuiltInExtensionArtifacts(source, destination);
}
