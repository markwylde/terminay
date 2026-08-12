import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import type { ExtensionMaterializer, ExtensionRegistryClient, RegistryPackageResolution } from "./installerTypes.js";

const executeFile = promisify(execFile);
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const SELECTOR = /^(?:latest|next|beta|\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?|[~^><= *|.\dA-Za-z-]+)$/u;

export function parsePublicNpmSpec(input: string): { packageName: string; selector: string } {
  const value = input.trim();
  if (value.length === 0 || value.length > 300 || /^(?:git|https?|file|link|npm):/iu.test(value) || value.includes("\\")) throw new TypeError("only public npmjs package names are supported");
  const separator = value.startsWith("@") ? value.indexOf("@", 1) : value.indexOf("@");
  const packageName = separator < 0 ? value : value.slice(0, separator);
  const selector = separator < 0 ? "latest" : value.slice(separator + 1);
  if (!PACKAGE.test(packageName) || !SELECTOR.test(selector) || selector.length === 0) throw new TypeError("invalid public npm package specification");
  return { packageName, selector };
}

export interface NpmCliOptions { readonly npmCliPath?: string; readonly workRoot: string; readonly npmVersion?: string; }

export function bundledNpmCliPath(): string {
  const entry = createRequire(import.meta.url).resolve("npm");
  return join(dirname(entry), "bin", "npm-cli.js");
}

/** npmjs-only adapter. npm executes through the server's bundled CLI with a
 * sterile home/cache/userconfig and never inherits registry credentials. */
export class NpmCliRegistryClient implements ExtensionRegistryClient, ExtensionMaterializer {
  readonly npmVersion: string;
  constructor(private readonly options: NpmCliOptions) { this.npmVersion = options.npmVersion ?? "11.9.0"; }

  async resolve(packageName: string, selector: string, signal?: AbortSignal): Promise<RegistryPackageResolution> {
    const spec = `${packageName}@${selector}`;
    const versionResult = await this.run(["view", spec, "version", "--json"], join(this.options.workRoot, "resolve"), signal);
    let versionValue: unknown;
    try { versionValue = JSON.parse(versionResult.stdout); } catch { throw new Error("npm registry returned invalid version metadata"); }
    const exactVersion = Array.isArray(versionValue) ? versionValue.at(-1) : versionValue;
    if (typeof exactVersion !== "string") throw new Error("npm registry did not resolve an exact version");
    const result = await this.run(["view", `${packageName}@${exactVersion}`, "name", "version", "dist.integrity", "dist.tarball", "maintainers", "repository", "dependencies", "terminay", "--json"], join(this.options.workRoot, "resolve"), signal);
    let metadata: Record<string, unknown>;
    try { metadata = JSON.parse(result.stdout) as Record<string, unknown>; } catch { throw new Error("npm registry returned invalid metadata"); }
    if (metadata.name !== packageName || typeof metadata.version !== "string" || typeof metadata["dist.integrity"] !== "string") throw new Error("npm registry response is missing exact integrity metadata");
    const repository = metadata.repository;
    return Object.freeze({
      packageName,
      version: metadata.version,
      integrity: metadata["dist.integrity"],
      ...(typeof metadata["dist.tarball"] === "string" ? { tarballUrl: metadata["dist.tarball"] } : {}),
      ...(typeof repository === "string" ? { repository } : typeof repository === "object" && repository !== null && typeof (repository as { url?: unknown }).url === "string" ? { repository: (repository as { url: string }).url } : {}),
      maintainers: Array.isArray(metadata.maintainers) ? metadata.maintainers.map((value) => typeof value === "string" ? value : String((value as { name?: unknown }).name ?? "")).filter(Boolean).slice(0, 20) : [],
      dependencyCount: typeof metadata.dependencies === "object" && metadata.dependencies !== null ? Object.keys(metadata.dependencies).length : 0,
      manifestMetadata: metadata.terminay,
      provenance: "unavailable",
    });
  }

  async materialize(resolution: RegistryPackageResolution, stagingRoot: string, signal?: AbortSignal): Promise<void> {
    await mkdir(stagingRoot, { recursive: false });
    await writeFile(join(stagingRoot, "package.json"), `${JSON.stringify({ private: true, dependencies: { [resolution.packageName]: resolution.version } }, null, 2)}\n`, { flag: "wx" });
    await this.run(["install", `${resolution.packageName}@${resolution.version}`, "--save-exact", "--ignore-scripts", "--omit=dev", "--no-bin-links", "--package-lock=true", "--audit=false", "--fund=false"], stagingRoot, signal);
  }

  private async run(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
    await mkdir(cwd, { recursive: true });
    const sterile = join(this.options.workRoot, "npm-runtime");
    await mkdir(join(sterile, "home"), { recursive: true });
    await mkdir(join(sterile, "cache"), { recursive: true });
    const userconfig = join(sterile, "npmrc");
    await writeFile(userconfig, `registry=${PUBLIC_REGISTRY}\nalways-auth=false\nignore-scripts=true\nbin-links=false\n`, { mode: 0o600 });
    try {
      return await executeFile(process.execPath, [this.options.npmCliPath ?? bundledNpmCliPath(), ...args, "--registry", PUBLIC_REGISTRY, "--userconfig", userconfig], {
        cwd, signal, timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
        env: { NODE_ENV: "production", HOME: join(sterile, "home"), npm_config_cache: join(sterile, "cache"), npm_config_registry: PUBLIC_REGISTRY, npm_config_userconfig: userconfig } as unknown as NodeJS.ProcessEnv,
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
      if (["ENETUNREACH", "ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT"].includes(code)) throw new Error("npmjs registry is unavailable");
      throw new Error(`bundled npm command failed (${code})`);
    }
  }
}
