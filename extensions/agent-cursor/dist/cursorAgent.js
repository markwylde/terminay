import { open, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defineAgentProvider, jsonlSession, } from "@terminay/extension-api";
const MAPPING_VERSION = "0.1";
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_INITIAL_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 4_000;
const MAX_TITLE_CHARS = 200;
const POLL_MS = 250;
const CURSOR_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu;
/**
 * Cursor Agent CLI provider mapping v0.1.
 *
 * The writable Cursor chat store held by a process below the exact Terminal
 * PTY is the binding proof. The transcript's UUID is path-derived because
 * Cursor's JSONL records have no trustworthy session header.
 */
export function createCursorAgentProvider(options = {}) {
    const cursorHome = resolve(options.cursorHome ?? join(homedir(), ".cursor"));
    const chatsRoot = join(cursorHome, "chats");
    const projectsRoot = join(cursorHome, "projects");
    return defineAgentProvider({
        mappingVersion: MAPPING_VERSION,
        matchesForeground: isCursorForeground,
        async observe(terminal) {
            if (!terminal.capabilities.has("process-observation")
                || !terminal.capabilities.has("filesystem-observation")
                || !terminal.capabilities.has("agent-journal")) {
                return { state: "unavailable", reason: "environment-capability-missing" };
            }
            const descendants = await terminal.observation.processes.descendants({ signal: terminal.signal });
            const writableFiles = await terminal.observation.processes.openFiles(descendants, {
                access: "writable",
                signal: terminal.signal,
            });
            for (const candidate of writableFiles) {
                if (basename(candidate.path) !== "store.db")
                    continue;
                // Canonicalizing the opaque handle asks the selected environment to
                // validate the evidence before it becomes a binding fingerprint.
                const storeHandle = await terminal.observation.files.canonicalFile(candidate.handle, {
                    beneath: { homeRelative: ".cursor/chats" },
                    signal: terminal.signal,
                });
                if (!storeHandle)
                    continue;
                // Node is deliberately used for Cursor's local companion metadata:
                // `path` cannot establish identity; it is used only after the host has
                // accepted the open-file handle above. Remote environments must expose
                // equivalent sibling-file operations before this extension can support
                // Cursor there.
                const files = await discoverCursorSession(candidate.path, chatsRoot, projectsRoot);
                if (!files)
                    continue;
                const binding = await terminal.bindSession({
                    providerSessionId: files.sessionId,
                    mappingVersion: MAPPING_VERSION,
                    fingerprint: {
                        kind: "writable-file-below-terminal-process",
                        file: storeHandle,
                        metadata: { cursorStore: "v0.1" },
                    },
                });
                return jsonlSession({
                    binding,
                    source: new CursorSessionWatcher(files, { pollMs: options.pollMs ?? POLL_MS, signal: terminal.signal }),
                    mapRecord: createRecordMapper(),
                });
            }
            return { state: "not-bound" };
        },
    });
}
export const cursorAgentProvider = createCursorAgentProvider();
function isCursorForeground(process) {
    const executable = basename(process.executableName).toLowerCase();
    if (executable === "agent" || executable === "cursor-agent")
        return true;
    // Cursor often swaps the CLI launcher for its bundled Node worker. Keep the
    // observer armed only when its command arguments make that identity exact.
    return executable === "node" && (process.arguments ?? []).some((argument) => /(?:^|[/\\])cursor-agent[/\\]versions[/\\][^/\\\s]+[/\\](?:node[/\\])?[^\s]*index\.js$/u.test(argument));
}
async function discoverCursorSession(storeCandidate, chatsRoot, projectsRoot) {
    const canonicalChats = await realpath(chatsRoot).catch(() => undefined);
    const canonicalProjects = await realpath(projectsRoot).catch(() => undefined);
    const storePath = await realpath(storeCandidate).catch(() => undefined);
    if (!canonicalChats || !canonicalProjects || !storePath || basename(storePath) !== "store.db")
        return undefined;
    const parts = relative(canonicalChats, storePath).split(/[\\/]/u);
    if (parts.length !== 3 || parts.some((part) => part === "..") || !CURSOR_SESSION_ID.test(parts[1] ?? ""))
        return undefined;
    const sessionId = parts[1];
    const metadataPath = join(dirname(storePath), "meta.json");
    const metadata = await readCursorMetadata(metadataPath, canonicalChats);
    if (!metadata?.cwd)
        return undefined;
    const canonicalCwd = await realpath(metadata.cwd).catch(() => undefined);
    if (!canonicalCwd)
        return undefined;
    const projectKey = canonicalCwd.replace(/^\/+/, "").replaceAll("/", "-");
    if (!projectKey || projectKey.includes(".."))
        return undefined;
    const transcriptPath = join(canonicalProjects, projectKey, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
    const canonicalTranscript = await safeBeneath(transcriptPath, canonicalProjects, ".jsonl");
    return canonicalTranscript ? { sessionId, transcriptPath: canonicalTranscript, metadataPath, storePath } : undefined;
}
async function readCursorMetadata(path, chatsRoot) {
    const safe = await safeBeneath(path, chatsRoot, ".json");
    if (!safe || basename(safe) !== "meta.json")
        return undefined;
    const bytes = await readFile(safe).catch(() => undefined);
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_METADATA_BYTES)
        return undefined;
    try {
        const raw = JSON.parse(bytes.toString("utf8"));
        const document = {
            ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}),
            ...(typeof raw.title === "string" ? { title: raw.title } : {}),
        };
        return {
            ...document,
            ...(boundedString(document.title, MAX_TITLE_CHARS) ? { title: boundedString(document.title, MAX_TITLE_CHARS) } : {}),
        };
    }
    catch {
        return undefined;
    }
}
async function readCursorModelId(path, chatsRoot) {
    const safe = await safeBeneath(path, chatsRoot, ".db");
    if (!safe || basename(safe) !== "store.db")
        return undefined;
    let database;
    try {
        database = new DatabaseSync(safe, { readOnly: true });
        const row = database.prepare("SELECT value FROM meta WHERE key = ? LIMIT 1").get("0");
        if (typeof row?.value !== "string" || row.value.length === 0 || row.value.length > MAX_METADATA_BYTES * 2)
            return undefined;
        const json = /^[0-9a-f]+$/iu.test(row.value) && row.value.length % 2 === 0
            ? Buffer.from(row.value, "hex").toString("utf8")
            : row.value;
        const value = JSON.parse(json).lastUsedModel;
        return boundedString(value, MAX_TITLE_CHARS);
    }
    catch {
        return undefined;
    }
    finally {
        database?.close();
    }
}
async function safeBeneath(path, root, suffix) {
    if (!isAbsolute(path) || !path.endsWith(suffix))
        return undefined;
    const [candidate, canonicalRoot] = await Promise.all([realpath(path), realpath(root)]).catch(() => []);
    if (!candidate || !canonicalRoot)
        return undefined;
    const rel = relative(canonicalRoot, candidate);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? candidate : undefined;
}
/** Extracts only user-authored text from Cursor's timestamp/query wrapper. */
export function cursorPromptText(record) {
    const envelope = object(record);
    const message = object(envelope?.message);
    const text = (Array.isArray(message?.content) ? message.content : [])
        .map(object)
        .filter((item) => item?.type === "text")
        .map((item) => boundedString(item.text, MAX_PROMPT_CHARS))
        .filter((item) => item !== undefined)
        .join("")
        .slice(0, MAX_PROMPT_CHARS);
    const wrapped = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/u.exec(text)?.[1];
    return boundedString(wrapped, MAX_PROMPT_CHARS) ?? boundedString(text, MAX_PROMPT_CHARS);
}
/** Creates a friendly model label from Cursor's persisted `lastUsedModel`. */
export function cursorModelDisplayName(modelId) {
    return modelId.split("-").map((part) => /^\d/u.test(part)
        ? part
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}
function createRecordMapper() {
    let metadata = {};
    let turnOrdinal = 0;
    return (record, session) => mapRecord(record, session, metadata, (next) => { metadata = next; }, () => ++turnOrdinal);
}
function mapRecord(record, session, metadata, setMetadata, nextTurnOrdinal) {
    const envelope = object(record);
    if (!envelope)
        return;
    if (envelope.type === "terminay.cursor_metadata") {
        const title = boundedString(envelope.title, MAX_TITLE_CHARS);
        const modelId = boundedString(envelope.modelId, MAX_TITLE_CHARS);
        const next = { ...(title ? { title } : {}), ...(modelId ? { modelId } : {}) };
        setMetadata(next);
        if (title || modelId)
            session.publish.metadataChanged({
                ...(title ? { title } : {}),
                ...(modelId ? { model: modelMetadata(modelId) } : {}),
            });
        return;
    }
    if (envelope.role === "user") {
        // Repeated `session.started` events are intentionally idempotent in the
        // host. Each user prompt refreshes the title/model and begins a turn.
        session.publish.sessionStarted({
            ...(metadata.title ? { title: metadata.title } : {}),
            ...(metadata.modelId ? { model: modelMetadata(metadata.modelId) } : {}),
        });
        const promptText = cursorPromptText(envelope);
        const turnId = `cursor-turn-${nextTurnOrdinal()}`;
        session.publish.turnStarted(promptText ? { turnId, promptText } : { turnId });
        return;
    }
    if (envelope.role === "assistant") {
        session.publish.turnStarted({ turnId: `cursor-turn-${nextTurnOrdinal()}` });
        return;
    }
    if (envelope.type === "turn_ended") {
        session.publish.done({ outcome: completionOutcome(envelope.status) });
    }
}
function modelMetadata(modelId) {
    return { id: modelId, displayName: cursorModelDisplayName(modelId) };
}
function completionOutcome(status) {
    const value = boundedString(status, 100)?.toLowerCase();
    if (value?.includes("cancel") || value?.includes("abort"))
        return "cancelled";
    return value?.includes("error") || value?.includes("fail") ? "error" : "success";
}
function boundedString(value, maximum) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maximum) : undefined;
}
function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
/**
 * A bounded Node watcher for local Cursor files. It emits only transcript
 * bytes plus synthetic, allowlisted metadata records; it never forwards raw
 * store or meta documents. The extension host still owns JSONL decoding,
 * ordering, cancellation and lifecycle validation.
 */
class CursorSessionWatcher {
    files;
    options;
    closed = false;
    transcriptOffset = 0;
    transcriptModified = 0;
    metadataModified = 0;
    storeModified = 0;
    lastMetadata = "";
    constructor(files, options) {
        this.files = files;
        this.options = options;
    }
    dispose() { this.closed = true; }
    async *[Symbol.asyncIterator]() {
        while (!this.closed && !this.options.signal.aborted) {
            const metadata = await this.nextMetadataChunk();
            if (metadata)
                yield metadata;
            const transcript = await this.nextTranscriptChunk();
            if (transcript)
                yield transcript;
            if (!metadata && !transcript)
                await sleep(this.options.pollMs);
        }
    }
    async nextMetadataChunk() {
        const [metaStat, storeStat] = await Promise.all([
            stat(this.files.metadataPath).catch(() => undefined),
            stat(this.files.storePath).catch(() => undefined),
        ]);
        const metadataChanged = metaStat !== undefined && metaStat.mtimeMs !== this.metadataModified;
        const storeChanged = storeStat !== undefined && storeStat.mtimeMs !== this.storeModified;
        if (!metadataChanged && !storeChanged)
            return undefined;
        this.metadataModified = metaStat?.mtimeMs ?? this.metadataModified;
        this.storeModified = storeStat?.mtimeMs ?? this.storeModified;
        const metadata = await readCursorMetadata(this.files.metadataPath, dirname(dirname(dirname(this.files.storePath))));
        const modelId = await readCursorModelId(this.files.storePath, dirname(dirname(dirname(this.files.storePath))));
        const value = JSON.stringify({ type: "terminay.cursor_metadata", ...(metadata?.title ? { title: metadata.title } : {}), ...(modelId ? { modelId } : {}) });
        if (value === this.lastMetadata)
            return undefined;
        this.lastMetadata = value;
        return { type: "append", bytes: new TextEncoder().encode(`${value}\n`) };
    }
    async nextTranscriptChunk() {
        const current = await stat(this.files.transcriptPath).catch(() => undefined);
        if (!current?.isFile())
            return undefined;
        const replaced = this.transcriptModified !== 0 && current.mtimeMs !== this.transcriptModified && current.size < this.transcriptOffset;
        const truncated = current.size < this.transcriptOffset;
        const changed = current.size !== this.transcriptOffset || current.mtimeMs !== this.transcriptModified;
        if (!changed)
            return undefined;
        const start = truncated || replaced ? 0 : this.transcriptOffset;
        const maximum = start === 0 ? MAX_INITIAL_TRANSCRIPT_BYTES : Math.min(MAX_INITIAL_TRANSCRIPT_BYTES, Math.max(0, current.size - start));
        const bytes = await readRange(this.files.transcriptPath, start, maximum);
        this.transcriptOffset = start + bytes.byteLength;
        this.transcriptModified = current.mtimeMs;
        if (bytes.byteLength === 0)
            return undefined;
        return { type: truncated || replaced ? "truncate" : "append", bytes };
    }
}
async function readRange(path, start, maximum) {
    if (maximum <= 0)
        return new Uint8Array();
    const file = await open(path, "r").catch(() => undefined);
    if (!file)
        return new Uint8Array();
    try {
        const bytes = Buffer.allocUnsafe(maximum);
        const result = await file.read(bytes, 0, maximum, start);
        return new Uint8Array(bytes.buffer, bytes.byteOffset, result.bytesRead).slice();
    }
    finally {
        await file.close();
    }
}
function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
//# sourceMappingURL=cursorAgent.js.map