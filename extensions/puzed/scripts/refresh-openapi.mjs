import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = process.env.PUZED_OPENAPI_TYPES_SOURCE;
if (typeof source !== "string" || source.trim() === "") {
  throw new Error("Set PUZED_OPENAPI_TYPES_SOURCE to the generated Puzed OpenAPI TypeScript declaration before refreshing it.");
}
await copyFile(resolve(source), new URL("../src/generated/openapi.d.ts", import.meta.url));
