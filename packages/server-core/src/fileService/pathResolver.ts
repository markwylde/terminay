import { FileServiceError, type CanonicalPathAdapter, type PathStat } from "./types.js";

export interface CanonicalProjectPathOptions {
  readonly allowMissing?: boolean;
  readonly requireFile?: boolean;
  readonly requireDirectory?: boolean;
  readonly maxPathLength?: number;
}

export interface CanonicalProjectPathResolverOptions extends CanonicalProjectPathOptions {
  readonly projectRoot: string;
  readonly adapter: CanonicalPathAdapter;
}

/**
 * Resolves paths at the server boundary. A lexical `join` is never treated as
 * authorization: the final path is realpathed and checked against the
 * realpathed project root on every call. Missing leaf paths are safe only when
 * their nearest existing parent can also be canonicalized inside the root.
 */
export class CanonicalProjectPathResolver {
  readonly projectRoot: string;
  readonly adapter: CanonicalPathAdapter;
  readonly options: Readonly<CanonicalProjectPathOptions>;

  constructor(projectRoot: string, adapter: CanonicalPathAdapter, options?: CanonicalProjectPathOptions);
  constructor(options: CanonicalProjectPathResolverOptions);
  constructor(
    projectRootOrOptions: string | CanonicalProjectPathResolverOptions,
    adapter?: CanonicalPathAdapter,
    options: CanonicalProjectPathOptions = {},
  ) {
    if (typeof projectRootOrOptions === "string") {
      this.projectRoot = projectRootOrOptions;
      this.adapter = adapter as CanonicalPathAdapter;
      this.options = { ...options };
    } else {
      this.projectRoot = projectRootOrOptions.projectRoot;
      this.adapter = projectRootOrOptions.adapter;
      this.options = { ...projectRootOrOptions };
    }
    if (typeof this.projectRoot !== "string" || this.projectRoot.length === 0 || this.projectRoot.includes("\0")) {
      throw new FileServiceError("invalid_path", "project root is invalid");
    }
    if (this.adapter === undefined || typeof this.adapter.realpath !== "function" || typeof this.adapter.stat !== "function") {
      throw new TypeError("canonical path adapter must provide realpath and stat");
    }
    if (this.options.maxPathLength !== undefined && (!Number.isSafeInteger(this.options.maxPathLength) || this.options.maxPathLength <= 0)) {
      throw new RangeError("maxPathLength must be a positive safe integer");
    }
  }

  private rootPromise: Promise<string> | undefined;

  async root(): Promise<string> {
    this.rootPromise ??= this.resolveRoot();
    try {
      return await this.rootPromise;
    } catch (error) {
      this.rootPromise = undefined;
      throw error;
    }
  }

  private async resolveRoot(): Promise<string> {
    const canonical = await this.canonicalExisting(this.projectRoot, false);
    const stat = await this.adapter.stat(canonical);
    if (stat.isDirectory === false) throw new FileServiceError("not_directory", "project root is not a directory", { canonical });
    return canonical;
  }

  /** Resolve a project-relative or already absolute request to its canonical path. */
  async resolve(requestedPath: string, options: CanonicalProjectPathOptions = {}): Promise<string> {
    const maxPathLength = options.maxPathLength ?? this.options.maxPathLength ?? 4096;
    if (typeof requestedPath !== "string" || requestedPath.length === 0 || requestedPath.length > maxPathLength || requestedPath.includes("\0")) {
      throw new FileServiceError("invalid_path", "requested path is invalid", { requested: requestedPath });
    }
    if (hasTraversalSegment(requestedPath)) throw new FileServiceError("path_escape", "path traversal is not permitted", { requested: requestedPath });

    const root = await this.root();
    if (
      !isAbsolutePath(requestedPath) &&
      (requestedPath === "." || requestedPath === "")
    ) {
      if (options.requireFile ?? false)
        throw new FileServiceError("not_file", "path is not a file", { canonical: root });
      return root;
    }
    // For relative requests the project root is the only starting point. An
    // absolute path is accepted only after canonical containment is checked.
    const candidate = isAbsolutePath(requestedPath) ? requestedPath : joinPath(root, requestedPath);
    const canonical = await this.canonicalTarget(candidate, options.allowMissing ?? this.options.allowMissing ?? false);
    if (!isWithin(root, canonical)) throw new FileServiceError("path_escape", "path is outside the project root", { requested: requestedPath, canonical });

    let stat: PathStat;
    try {
      stat = await this.adapter.stat(canonical);
    } catch {
      if (options.allowMissing ?? this.options.allowMissing ?? false) return canonical;
      throw new FileServiceError("path_missing", "path does not exist", { requested: requestedPath, canonical });
    }
    if ((options.requireFile ?? false) && stat.isFile === false) throw new FileServiceError("not_file", "path is not a file", { canonical });
    if ((options.requireDirectory ?? false) && stat.isDirectory === false) throw new FileServiceError("not_directory", "path is not a directory", { canonical });
    return canonical;
  }

  resolvePath(requestedPath: string, options?: CanonicalProjectPathOptions): Promise<string> {
    return this.resolve(requestedPath, options);
  }

  async isWithinProject(path: string): Promise<boolean> {
    try { await this.resolve(path); return true; } catch (error) { if (error instanceof FileServiceError && (error.code === "path_escape" || error.code === "path_missing")) return false; throw error; }
  }

  private async canonicalExisting(path: string, missingAllowed: boolean): Promise<string> {
    try {
      const canonical = await this.adapter.realpath(path);
      if (typeof canonical !== "string" || canonical.length === 0) throw new Error("invalid realpath result");
      return canonical;
    } catch (error) {
      if (!missingAllowed || !isMissingError(error)) throw new FileServiceError("path_missing", "path does not exist", { requested: path });
      return this.canonicalMissing(path);
    }
  }

  private async canonicalTarget(path: string, allowMissing: boolean): Promise<string> {
    try {
      const canonical = await this.adapter.realpath(path);
      if (typeof canonical !== "string" || canonical.length === 0) throw new Error("invalid realpath result");
      // A stat call is deliberately part of canonicalization. This closes the
      // gap where a host's realpath implementation returns a stale path.
      await this.adapter.stat(canonical);
      return canonical;
    } catch (error) {
      if (!allowMissing || !isMissingError(error)) {
        if (error instanceof FileServiceError) throw error;
        throw new FileServiceError("path_missing", "path does not exist", { requested: path });
      }
      if (this.adapter.lstat !== undefined) {
        try {
          const leaf = await this.adapter.lstat(path);
          if (leaf.isSymbolicLink === true) throw new FileServiceError("path_escape", "dangling symlink cannot be authorized", { requested: path });
        } catch (leafError) {
          if (leafError instanceof FileServiceError) throw leafError;
          if (!isMissingError(leafError)) throw leafError;
        }
      }
      return this.canonicalMissing(path);
    }
  }

  private async canonicalMissing(path: string): Promise<string> {
    let cursor = path;
    const suffix: string[] = [];
    while (true) {
      try {
        const parent = await this.adapter.realpath(cursor);
        const canonical = joinPath(parent, ...suffix);
        if (this.adapter.lstat !== undefined) {
          try {
            const stat = await this.adapter.lstat(canonical);
            if (stat.isSymbolicLink === true) throw new FileServiceError("path_escape", "symlink target cannot be authorized", { canonical });
          } catch (error) {
            if (error instanceof FileServiceError) throw error;
            if (!isMissingError(error)) throw error;
          }
        }
        return canonical;
      } catch (error) {
        if (!isMissingError(error)) throw error;
        const parent = dirnamePath(cursor);
        if (parent === cursor) throw new FileServiceError("path_missing", "no existing project parent", { requested: path });
        suffix.unshift(basenamePath(cursor));
        cursor = parent;
      }
    }
  }
}

export async function resolveCanonicalProjectPath(
  projectRoot: string,
  requestedPath: string,
  adapter: CanonicalPathAdapter,
  options?: CanonicalProjectPathOptions,
): Promise<string> {
  return new CanonicalProjectPathResolver(projectRoot, adapter, options).resolve(requestedPath, options);
}

function hasTraversalSegment(path: string): boolean {
  return path.split(/[\\/]+/u).some((part) => part === "..");
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  const comparisonRoot = isWindowsPath(normalizedRoot) ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparisonCandidate = isWindowsPath(normalizedCandidate) ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  return comparisonCandidate === comparisonRoot || comparisonCandidate.startsWith(`${comparisonRoot}${separatorFor(normalizedRoot)}`);
}

function isMissingError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return error instanceof Error && /not found|no such file|enoent|enotdir/iu.test(error.message);
  const candidate = error as { readonly code?: unknown; readonly message?: unknown };
  return candidate.code === "ENOENT" || candidate.code === "ENOTDIR" || (typeof candidate.message === "string" && /not found|no such file|enoent|enotdir/iu.test(candidate.message));
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(path) || path.includes("\\");
}

function separatorFor(path: string): string {
  return isWindowsPath(path) ? "\\" : "/";
}

function normalizePath(path: string): string {
  const separator = separatorFor(path);
  const unified = path.replace(/[\\/]+/gu, "/");
  const drive = /^[A-Za-z]:/u.exec(unified)?.[0] ?? "";
  const rooted = unified.startsWith("/") || drive.length > 0;
  const parts = unified.split("/");
  if (drive.length > 0 && parts[0] === drive) parts.shift();
  const result: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === ".." && result.length > 0 && result.at(-1) !== "..") { result.pop(); continue; }
    if (part !== "..") result.push(part);
  }
  const prefix = drive.length > 0 ? `${drive}${rooted ? "/" : ""}` : rooted ? "/" : "";
  const value = `${prefix}${result.join("/")}` || (rooted ? "/" : ".");
  return separator === "/" ? value : value.replace(/\//gu, "\\");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\");
}

function joinPath(first: string, ...parts: string[]): string {
  const separator = separatorFor(first);
  let value = first;
  for (const part of parts) {
    if (part.length === 0) continue;
    value = `${value.replace(/[\\/]$/u, "")}${separator}${part.replace(/^[\\/]+/u, "")}`;
  }
  return normalizePath(value);
}

function dirnamePath(path: string): string {
  const normalized = normalizePath(path);
  const separator = separatorFor(normalized);
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index < 0) return ".";
  if (index === 0) return separator;
  if (index === 2 && /^[A-Za-z]:[\\/]/u.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, index);
}

function basenamePath(path: string): string {
  const normalized = normalizePath(path);
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return index < 0 ? normalized : normalized.slice(index + 1);
}
