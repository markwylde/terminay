import { defineAgentProvider, jsonlSession, safeAgentString } from "@terminay/extension-api";
import type {
  AgentBindingFingerprint,
  AgentFileHandle,
  AgentForegroundProcess,
  AgentObservationResult,
  AgentProcessSnapshot,
  AgentTerminalContext,
} from "@terminay/extension-api";
import { mapClaudeRecord } from "./mapping.js";
import { claudeProjectJournalPath, claudeResumeSessionId } from "./resume.js";

export const PROVIDER_ID = "com.terminay.agent.claude-code/cli";
const CLAUDE_PROJECTS = ".claude/projects";
const MAX_HEADER_BYTES = 64 * 1024;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu;

/**
 * Claude Code v0.1 observes only files currently held by the exact terminal
 * process tree. The host canonicalizes the candidate below `.claude/projects`
 * before this extension reads it, so filenames/cwds cannot bind a session.
 */
export const claudeCodeProvider = defineAgentProvider({
  mappingVersion: "0.1",

  matchesForeground(process: AgentForegroundProcess): boolean {
    return process.executableName === "claude";
  },

  async observe(terminal: AgentTerminalContext): Promise<AgentObservationResult> {
    if (!terminal.capabilities.has("process-observation") || !terminal.capabilities.has("agent-journal")) {
      return { state: "unavailable", reason: "environment-capability-missing" };
    }
    const descendants = await terminal.observation.processes.descendants({ signal: terminal.signal });
    const explicitResume = claudeResumeSessionId(terminal.foreground.arguments);
    const candidate = explicitResume
      ? await resumedJournalCandidate(terminal, descendants, explicitResume)
      : await writableJournalCandidate(terminal, descendants);
    if (!candidate) return { state: "not-bound" };
    const header = await terminal.observation.files.readJsonLine<unknown>(candidate.journal, {
      position: "first", maxBytes: MAX_HEADER_BYTES, signal: terminal.signal,
    });
    const sessionId = rootSessionId(header);
    if (!sessionId) return { state: "not-bound" };
    const binding = await terminal.bindSession({
      providerSessionId: sessionId,
      mappingVersion: "0.1",
      journal: candidate.journal,
      fingerprint: candidate.fingerprint,
      ...(providerVersion(header) ? { metadata: { providerVersion: providerVersion(header)! } } : {}),
    });
    return jsonlSession({
      binding,
      source: terminal.observation.files.follow(candidate.journal, { signal: terminal.signal }),
      mapRecord: mapClaudeRecord,
    });
  },
});

interface JournalCandidate { readonly journal: AgentFileHandle; readonly fingerprint: AgentBindingFingerprint }

async function writableJournalCandidate(terminal: AgentTerminalContext, descendants: readonly AgentProcessSnapshot[]): Promise<JournalCandidate | undefined> {
  const openFiles = await terminal.observation.processes.openFiles(descendants, {
    access: "writable", signal: terminal.signal,
  });
  return rootJournalCandidate(terminal, openFiles.map((file) => file.handle));
}

async function resumedJournalCandidate(terminal: AgentTerminalContext, descendants: readonly AgentProcessSnapshot[], sessionId: string): Promise<JournalCandidate | undefined> {
  const candidates: JournalCandidate[] = [];
  for (const process of descendants) {
    if (process.executableName !== "claude" || !process.cwd) continue;
    const relativePath = claudeProjectJournalPath(process.cwd, sessionId);
    if (!relativePath) continue;
    const journal = await terminal.observation.files.resolveHomeRelative(relativePath, {
      beneath: { homeRelative: CLAUDE_PROJECTS }, extension: ".jsonl", signal: terminal.signal,
    });
    if (!journal) continue;
    const header = await terminal.observation.files.readJsonLine<unknown>(journal, {
      position: "first", maxBytes: MAX_HEADER_BYTES, signal: terminal.signal,
    });
    if (rootSessionId(header) !== sessionId) continue;
    candidates.push({
      journal,
      fingerprint: {
        kind: "explicit-resume-argument-and-project-journal",
        process: process.handle,
        file: journal,
        metadata: { providerSessionId: sessionId },
      },
    });
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

async function rootJournalCandidate(terminal: AgentTerminalContext, writers: readonly AgentFileHandle[]): Promise<JournalCandidate | undefined> {
  const candidates: JournalCandidate[] = [];
  for (const writer of writers) {
    const journal = await terminal.observation.files.canonicalFile(writer, {
      beneath: { homeRelative: CLAUDE_PROJECTS }, extension: ".jsonl", signal: terminal.signal,
    });
    if (!journal) continue;
    // Claude's sidechain journals live below a subagents directory. The header
    // check below is authoritative; this inexpensive path filter prevents a
    // sidechain becoming a root candidate on path-preserving environments.
    const file = await terminal.observation.files.readJsonLine<unknown>(journal, {
      position: "first", maxBytes: MAX_HEADER_BYTES, signal: terminal.signal,
    });
    if (!rootSessionId(file)) continue;
    candidates.push({ journal, fingerprint: { kind: "writable-file-below-terminal-process", file: writer } });
  }
  // More than one root journal held by one exact process tree is ambiguous.
  // Do not choose by mtime, title, cwd, or filename.
  return candidates.length === 1 ? candidates[0] : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function rootSessionId(value: unknown): string | undefined {
  const envelope = record(value);
  if (!envelope || envelope.isSidechain === true) return undefined;
  const id = safeAgentString(envelope.sessionId)?.slice(0, 512);
  return id && SESSION_ID.test(id) ? id : undefined;
}

function providerVersion(value: unknown): string | undefined {
  return safeAgentString(record(value)?.version)?.slice(0, 100);
}
