import { CanonicalProjectPathResolver } from "./pathResolver.js";
import { FileServiceError } from "./types.js";
import type { FileCatalogStorage, FileDirectoryEntry } from "./catalog.js";

/** A checkbox task discovered in a project-relative Markdown file. */
export interface MarkdownTaskItem {
  readonly id: string;
  readonly relativePath: string;
  readonly lineNumber: number;
  readonly label: string;
  readonly checked: boolean;
  readonly depth: number;
  readonly sectionPath: readonly string[];
}

/** Heading grouping for a Markdown file. Tasks remain attached to their heading. */
export interface MarkdownTaskSection {
  readonly id: string;
  readonly title: string | null;
  readonly level: number;
  readonly tasks: readonly MarkdownTaskItem[];
  readonly children: readonly MarkdownTaskSection[];
}

export interface MarkdownTaskStats {
  readonly total: number;
  readonly completed: number;
  readonly remaining: number;
}

export interface MarkdownTaskFile {
  readonly relativePath: string;
  readonly size: number;
  readonly mtimeMs?: number;
  readonly sections: readonly MarkdownTaskSection[];
  readonly tasks: readonly MarkdownTaskItem[];
  readonly stats: MarkdownTaskStats;
  /** True when byte, task, or malformed-input bounds prevented a complete parse. */
  readonly truncated: boolean;
  readonly invalidEncoding: boolean;
}

export interface MarkdownTaskDirectory {
  readonly name: string;
  /** Project-relative; the aggregate root is represented by `.`. */
  readonly relativePath: string;
  readonly directories: readonly MarkdownTaskDirectory[];
  readonly files: readonly MarkdownTaskFile[];
  readonly stats: MarkdownTaskStats;
}

export interface MarkdownTaskAggregationOptions {
  readonly maxDepth?: number;
  readonly maxEntries?: number;
  readonly maxFiles?: number;
  readonly maxBytes?: number;
  readonly maxTasks?: number;
  readonly maxFileBytes?: number;
  readonly maxTaskLabelLength?: number;
  readonly ignoredDirectories?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface MarkdownTaskAggregationResult {
  readonly root: string;
  readonly tree: MarkdownTaskDirectory;
  readonly files: readonly MarkdownTaskFile[];
  readonly tasks: readonly MarkdownTaskItem[];
  readonly stats: MarkdownTaskStats;
  readonly scannedEntries: number;
  readonly scannedFiles: number;
  readonly readBytes: number;
  readonly truncated: boolean;
}

const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_ENTRIES = 25_000;
const DEFAULT_MAX_FILES = 5_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TASKS = 10_000;
const DEFAULT_MAX_TASK_LABEL_LENGTH = 4_096;
const DEFAULT_IGNORED_DIRECTORIES = Object.freeze([
  ".git", ".hg", ".svn", ".next", ".turbo", ".vite", "coverage", "dist", "dist-electron", "node_modules", "release",
]);

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd"]);
const HEADING_PATTERN = /^(#{1,6})\s+(.*\S)\s*$/u;
const TASK_PATTERN = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/u;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u;

interface MutableSection {
  readonly id: string;
  readonly title: string | null;
  readonly level: number;
  readonly tasks: MarkdownTaskItem[];
  readonly children: MutableSection[];
}

interface MutableDirectory {
  readonly name: string;
  readonly relativePath: string;
  readonly directories: Map<string, MutableDirectory>;
  readonly files: MarkdownTaskFile[];
}

interface ParsedFile {
  readonly sections: readonly MarkdownTaskSection[];
  readonly tasks: readonly MarkdownTaskItem[];
  readonly truncated: boolean;
  readonly invalidEncoding?: boolean;
}

/**
 * Walk and parse Markdown task lists using the server's canonical project
 * resolver. Reads are deliberately sequential (one bounded range at a time),
 * so aggregation cannot exhaust host file descriptors or memory.
 */
export async function aggregateMarkdownTasks(
  resolver: CanonicalProjectPathResolver,
  storage: FileCatalogStorage,
  requestedPath = ".",
  options: MarkdownTaskAggregationOptions = {},
): Promise<MarkdownTaskAggregationResult> {
  const signal = options.signal;
  throwIfAborted(signal);
  const root = normalizeRelative(requestedPath);
  const maxDepth = positive(options.maxDepth ?? DEFAULT_MAX_DEPTH, "maxDepth");
  const maxEntries = positive(options.maxEntries ?? DEFAULT_MAX_ENTRIES, "maxEntries");
  const maxFiles = positive(options.maxFiles ?? DEFAULT_MAX_FILES, "maxFiles");
  const maxBytes = positive(options.maxBytes ?? DEFAULT_MAX_BYTES, "maxBytes");
  const maxTasks = positive(options.maxTasks ?? DEFAULT_MAX_TASKS, "maxTasks");
  const maxFileBytes = positive(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, "maxFileBytes");
  const maxTaskLabelLength = positive(options.maxTaskLabelLength ?? DEFAULT_MAX_TASK_LABEL_LENGTH, "maxTaskLabelLength");
  const ignored = (options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES).map(validPattern);
  const canonical = await resolver.resolve(root || ".");
  const rootStat = await storage.stat(canonical);
  const files: MarkdownTaskFile[] = [];
  const pending: Array<{ readonly relativePath: string; readonly depth: number; readonly canonical: string }> = [];
  let scannedEntries = 0;
  let scannedFiles = 0;
  let readBytes = 0;
  let discoveredTasks = 0;
  let truncated = false;

  if (rootStat.isFile === true) {
    if (isMarkdownPath(root)) {
      scannedFiles = 1;
      const parsed = await readMarkdownFile(root || basename(canonical), canonical, storage, Math.min(maxFileBytes, maxBytes), maxTaskLabelLength, signal);
      readBytes = Math.min(parsed.bytesRead, maxBytes);
      files.push(makeFile(root || basename(canonical), parsed, rootStat.size, rootStat.mtimeMs, maxBytes < parsed.bytesRead));
      discoveredTasks = files[0]?.tasks.length ?? 0;
      truncated = parsed.truncated || parsed.bytesRead > maxBytes;
    }
  } else if (rootStat.isDirectory === true) {
    pending.push({ relativePath: root, depth: 0, canonical });
  }

  while (pending.length > 0 && !truncated) {
    throwIfAborted(signal);
    const current = pending.shift();
    if (current === undefined) break;
    let entries: readonly FileDirectoryEntry[];
    try {
      entries = await storage.readDirectory(current.canonical, signal);
    } catch {
      continue;
    }
    for (const raw of entries) {
      throwIfAborted(signal);
      scannedEntries += 1;
      if (scannedEntries > maxEntries) {
        truncated = true;
        break;
      }
      const name = validEntryName(raw.name);
      const relativePath = current.relativePath.length === 0 ? name : `${current.relativePath}/${name}`;
      if (isIgnoredPath(relativePath, ignored)) continue;
      let childCanonical: string;
      let stat: { readonly isDirectory?: boolean; readonly isFile?: boolean; readonly isSymbolicLink?: boolean; readonly size?: number; readonly mtimeMs?: number };
      try {
        childCanonical = await resolver.resolve(relativePath);
        stat = await storage.stat(childCanonical);
      } catch (error) {
        // Escaped or stale links are omitted from a task result and never
        // become an authorization oracle for another project.
        if (error instanceof FileServiceError && (error.code === "path_escape" || error.code === "path_missing")) continue;
        throw error;
      }
      if (raw.isSymbolicLink === true || stat.isSymbolicLink === true) continue;
      if (stat.isDirectory === true || raw.isDirectory === true) {
        if (current.depth >= maxDepth) {
          truncated = true;
          break;
        }
        pending.push({ relativePath, depth: current.depth + 1, canonical: childCanonical });
        continue;
      }
      if (stat.isFile !== true && raw.isFile !== true) continue;
      if (!isMarkdownPath(relativePath)) continue;
      scannedFiles += 1;
      if (scannedFiles > maxFiles) {
        truncated = true;
        break;
      }
      const remainingBytes = maxBytes - readBytes;
      if (remainingBytes <= 0) {
        truncated = true;
        break;
      }
      const parsed = await readMarkdownFile(relativePath, childCanonical, storage, Math.min(maxFileBytes, remainingBytes), maxTaskLabelLength, signal);
      readBytes += parsed.bytesRead;
      const file = makeFile(relativePath, parsed, stat.size, stat.mtimeMs, parsed.bytesRead < safeSize(stat.size));
      files.push(file);
      discoveredTasks += file.tasks.length;
      if (parsed.truncated || parsed.bytesRead < safeSize(stat.size)) truncated = true;
      if (discoveredTasks > maxTasks) {
        truncated = true;
        break;
      }
    }
  }

  files.sort((left, right) => compareNames(left.relativePath, right.relativePath));
  const taskList = files.flatMap((file) => file.tasks);
  const tasks = taskList.slice(0, maxTasks);
  if (taskList.length > tasks.length) truncated = true;
  const tree = buildDirectoryTree(root || ".", files);
  return Object.freeze({
    root: root || ".",
    tree,
    files: Object.freeze(files),
    tasks: Object.freeze(tasks),
    stats: statsForTasks(tasks),
    scannedEntries,
    scannedFiles,
    readBytes,
    truncated,
  });
}

async function readMarkdownFile(
  relativePath: string,
  canonical: string,
  storage: FileCatalogStorage,
  maxBytes: number,
  maxTaskLabelLength: number,
  signal: AbortSignal | undefined,
): Promise<{ readonly bytesRead: number; readonly parsed: ParsedFile; readonly truncated: boolean }> {
  throwIfAborted(signal);
  if (storage.readRange === undefined) throw new FileServiceError("write_failed", "markdown aggregation requires ranged file reads");
  const stat = await storage.stat(canonical);
  const requested = Math.min(maxBytes, safeSize(stat.size));
  const bytes = await storage.readRange(canonical, 0, requested, signal);
  throwIfAborted(signal);
  if (!(bytes instanceof Uint8Array)) throw new FileServiceError("write_failed", "markdown range read returned invalid bytes");
  const bounded = bytes.byteLength > requested ? bytes.slice(0, requested) : bytes;
  let text: string;
  let invalidEncoding = false;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bounded);
  } catch {
    text = "";
    invalidEncoding = true;
  }
  const parsed = invalidEncoding ? { sections: Object.freeze([]), tasks: Object.freeze([]), truncated: true, invalidEncoding: true } : parseMarkdown(relativePath, text, maxTaskLabelLength);
  return { bytesRead: bounded.byteLength, parsed: { ...parsed, invalidEncoding }, truncated: parsed.truncated || invalidEncoding || bounded.byteLength < safeSize(stat.size) };
}

function parseMarkdown(relativePath: string, text: string, maxTaskLabelLength: number): ParsedFile {
  const root: MutableSection = { id: `${relativePath}:section-root`, title: null, level: 0, tasks: [], children: [] };
  const sectionStack: MutableSection[] = [root];
  const indentStack: number[] = [];
  const lines = text.split(/\r?\n/u);
  let inFence = false;
  let fenceMarker = "";
  let truncated = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = FENCE_PATTERN.exec(line);
    if (fence) {
      const markerValue = fence[1] ?? "";
      const marker = markerValue[0] ?? "`";
      if (!inFence) { inFence = true; fenceMarker = marker; } else if (marker === fenceMarker) { inFence = false; fenceMarker = ""; }
      continue;
    }
    if (inFence) continue;
    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      const level = (heading[1] ?? "#").length;
      const section: MutableSection = { id: `${relativePath}:section-${index}`, title: (heading[2] ?? "").trim(), level, tasks: [], children: [] };
      while (sectionStack.length > 1 && (sectionStack.at(-1)?.level ?? 0) >= level) sectionStack.pop();
      sectionStack.at(-1)?.children.push(section);
      sectionStack.push(section);
      indentStack.length = 0;
      continue;
    }
    const taskMatch = TASK_PATTERN.exec(line);
    if (!taskMatch) continue;
    const indent = taskMatch[1] ?? "";
    const marker = taskMatch[2] ?? " ";
    const rawLabel = taskMatch[3] ?? "";
    const label = rawLabel.trim().slice(0, maxTaskLabelLength);
    if (label.length === 0) continue;
    const width = indentWidth(indent);
    while (indentStack.length > 0 && (indentStack.at(-1) ?? 0) >= width) indentStack.pop();
    const sectionPath = sectionStack.slice(1).flatMap((section) => section.title === null ? [] : [section.title]);
    const task: MarkdownTaskItem = Object.freeze({ id: `${relativePath}:task-${index}`, relativePath, lineNumber: index + 1, label, checked: marker.toLowerCase() === "x", depth: indentStack.length, sectionPath: Object.freeze(sectionPath) });
    sectionStack.at(-1)?.tasks.push(task);
    indentStack.push(width);
    if (label.length === maxTaskLabelLength && rawLabel.trim().length > maxTaskLabelLength) truncated = true;
  }
  const sections = root.children.map(freezeSection);
  const tasks = [...root.tasks, ...flattenSections(sections)];
  return { sections: Object.freeze(sections), tasks: Object.freeze(tasks), truncated };
}

function freezeSection(section: MutableSection): MarkdownTaskSection {
  return Object.freeze({ id: section.id, title: section.title, level: section.level, tasks: Object.freeze([...section.tasks]), children: Object.freeze(section.children.map(freezeSection)) });
}

function flattenSections(sections: readonly MarkdownTaskSection[], output: MarkdownTaskItem[] = []): MarkdownTaskItem[] {
  for (const section of sections) { output.push(...section.tasks); flattenSections(section.children, output); }
  return output;
}

function makeFile(relativePath: string, parsed: { readonly parsed: ParsedFile; readonly truncated: boolean; readonly bytesRead: number }, size: number | undefined, mtimeMs: number | undefined, truncated: boolean): MarkdownTaskFile {
  const tasks = Object.freeze([...parsed.parsed.tasks]);
  return Object.freeze({ relativePath, size: safeSize(size), ...(finite(mtimeMs) ? { mtimeMs } : {}), sections: parsed.parsed.sections, tasks, stats: statsForTasks(tasks), truncated: truncated || parsed.truncated, invalidEncoding: parsed.parsed.invalidEncoding === true });
}

function buildDirectoryTree(root: string, files: readonly MarkdownTaskFile[]): MarkdownTaskDirectory {
  const rootNode: MutableDirectory = { name: root === "." ? "." : basename(root), relativePath: root, directories: new Map(), files: [] };
  for (const file of files) {
    const relative = root === "." ? file.relativePath : file.relativePath.slice(root.length + 1);
    const parts = relative.split("/");
    let node = rootNode;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index] ?? "";
      const path = node.relativePath === "." ? part : `${node.relativePath}/${part}`;
      const existing = node.directories.get(part);
      const child = existing ?? { name: part, relativePath: path, directories: new Map<string, MutableDirectory>(), files: [] };
      if (!existing) node.directories.set(part, child);
      node = child;
    }
    node.files.push(file);
  }
  return freezeDirectory(rootNode);
}

function freezeDirectory(node: MutableDirectory): MarkdownTaskDirectory {
  const directories = [...node.directories.values()].sort((left, right) => compareNames(left.name, right.name)).map(freezeDirectory);
  const files = [...node.files].sort((left, right) => compareNames(left.relativePath, right.relativePath));
  const directTasks = files.flatMap((file) => file.tasks);
  const childStats = directories.map((directory) => directory.stats);
  const stats = statsForStats(directStats(directTasks), childStats);
  return Object.freeze({ name: node.name, relativePath: node.relativePath, directories: Object.freeze(directories), files: Object.freeze(files), stats });
}

function statsForTasks(tasks: readonly MarkdownTaskItem[]): MarkdownTaskStats { const completed = tasks.reduce((count, task) => count + (task.checked ? 1 : 0), 0); return Object.freeze({ total: tasks.length, completed, remaining: tasks.length - completed }); }
function directStats(tasks: readonly MarkdownTaskItem[]): MarkdownTaskStats { return statsForTasks(tasks); }
function statsForStats(direct: MarkdownTaskStats, children: readonly MarkdownTaskStats[]): MarkdownTaskStats {
  const total = direct.total + children.reduce((sum, stats) => sum + stats.total, 0);
  const completed = direct.completed + children.reduce((sum, stats) => sum + stats.completed, 0);
  return Object.freeze({ total, completed, remaining: total - completed });
}
function isMarkdownPath(path: string): boolean { const name = basename(path).toLocaleLowerCase(); const dot = name.lastIndexOf("."); return dot > 0 && MARKDOWN_EXTENSIONS.has(name.slice(dot + 1)); }
function isIgnoredPath(path: string, patterns: readonly string[]): boolean { return path.split("/").some((part) => patterns.some((pattern) => wildcard(pattern, part))); }
function wildcard(pattern: string, value: string): boolean { let p = 0; let v = 0; let star = -1; let match = 0; while (v < value.length) { if (p < pattern.length && (pattern[p] === "?" || pattern[p] === value[v])) { p += 1; v += 1; continue; } if (p < pattern.length && pattern[p] === "*") { star = p; match = v; p += 1; continue; } if (star >= 0) { p = star + 1; match += 1; v = match; continue; } return false; } while (p < pattern.length && pattern[p] === "*") p += 1; return p === pattern.length; }
function normalizeRelative(value: string): string { if (typeof value !== "string" || value.includes("\0") || value.includes("\\") || value.startsWith("/")) throw new FileServiceError("invalid_path", "project-relative path is invalid", { requested: value }); if (value === "" || value === ".") return ""; const parts = value.split("/"); if (parts.some((part) => part.length === 0 || part === "." || part === "..")) throw new FileServiceError("path_escape", "project-relative path is not canonical", { requested: value }); return parts.join("/"); }
function validEntryName(name: string): string { if (typeof name !== "string" || name.length === 0 || name.length > 4096 || name.includes("\0") || name.includes("/") || name.includes("\\") || name === "." || name === "..") throw new FileServiceError("invalid_path", "directory entry name is invalid"); return name; }
function validPattern(pattern: string): string { if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > 256 || pattern.includes("\0") || pattern.includes("/")) throw new TypeError("ignore pattern is invalid"); return pattern; }
function indentWidth(indent: string): number { let width = 0; for (const character of indent) width += character === "\t" ? 2 : 1; return width; }
function safeSize(value: number | undefined): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function finite(value: number | undefined): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`); return value; }
function basename(path: string): string { const index = path.lastIndexOf("/"); return index < 0 ? path : path.slice(index + 1); }
function compareNames(left: string, right: string): number {
  const leftDepth = left.split("/").length;
  const rightDepth = right.split("/").length;
  if (leftDepth < rightDepth) return -1;
  if (leftDepth > rightDepth) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
function throwIfAborted(signal: AbortSignal | undefined): void { if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError"); }
