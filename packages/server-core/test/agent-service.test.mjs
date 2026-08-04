import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_HOOK_PATH,
  AGENT_HOOK_PROJECT_HEADER,
  AGENT_HOOK_SERVER_HEADER,
  AGENT_HOOK_SESSION_HEADER,
  AGENT_HOOK_TOKEN_HEADER,
  AgentStatusService,
  TerminalActivityService,
} from "../dist/activity/index.js";

const identity = (projectId = "project-a", sessionId = "session-a") => ({ serverId: "server-a", projectId, sessionId });

test("server agent service normalizes native hooks, keeps provider state authoritative, and acknowledges independently", async () => {
  let now = 100;
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => now });
  const agents = new AgentStatusService({ activity, receiver: { tokenFactory: () => "agent-hook-token" }, now: () => now });
  await agents.start();
  try {
    const first = identity();
    const environment = agents.prepareTerminalSession(first);
    assert.equal(environment.TERMINAY_SESSION_ID, "session-a");
    assert.match(environment.TERMINAY_AGENT_HOOK_ENDPOINT, /127\.0\.0\.1/);
    assert.equal(environment.TERMINAY_AGENT_HOOK_TOKEN, "agent-hook-token");

    assert.equal(await agents.ingestHookPayload(first, "codex", { hook_event_name: "SessionStart", session_id: "codex-session" }), true);
    assert.equal(await agents.ingestHookPayload(first, "codex", { hook_event_name: "UserPromptSubmit", session_id: "codex-session", prompt: "run tests" }), true);
    assert.equal(await agents.ingestHookPayload(first, "codex", { hook_event_name: "PermissionRequest", session_id: "codex-session", reason: "allow command" }), true);

    const root = Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "root");
    assert.ok(root);
    assert.equal(root.state, "waiting");
    assert.equal(root.unread, true);
    assert.equal(activity.get(first).providerState, "waiting");
    assert.equal(activity.get(first).source, "hook:codex");

    assert.equal(agents.acknowledge(first, root.entryId), true);
    assert.equal(agents.getSnapshot().entries[root.entryId].state, "waiting");
    assert.equal(agents.getSnapshot().entries[root.entryId].unread, false);
    const revision = agents.getSnapshot().revision;
    now = 101;
    assert.equal(agents.acknowledge(first, root.entryId), false);
    assert.equal(agents.getSnapshot().revision, revision);

    const rawSecret = JSON.stringify(agents.getSnapshot());
    assert.doesNotMatch(rawSecret, /TERMINAY_AGENT_HOOK_TOKEN|rawProviderSecret/);
  } finally {
    await agents.stop();
  }
});

test("server-owned integration disable revokes leases, clears state, and later issues only fresh leases", async () => {
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  let tokenCounter = 0;
  const agents = new AgentStatusService({
    activity,
    receiver: { tokenFactory: () => `toggle-token-${++tokenCounter}` },
    now: () => 100,
    enabled: false,
  });
  await agents.start();
  try {
    const first = identity();
    assert.deepEqual(agents.prepareTerminalSession(first), {});
    assert.equal(agents.integrationEnabled, false);

    agents.setIntegrationEnabled(true);
    const firstEnvironment = agents.prepareTerminalSession(first);
    assert.equal(firstEnvironment.TERMINAY_AGENT_HOOK_TOKEN, "toggle-token-1");
    await agents.ingestHookPayload(first, "codex", { hook_event_name: "SessionStart", session_id: "codex-session" });
    assert.equal(Object.keys(agents.getSnapshot().entries).length, 1);

    assert.equal(agents.setIntegrationEnabled(false), true);
    assert.deepEqual(agents.getSnapshot().entries, {});
    await assert.rejects(
      () => agents.ingestHookPayload(first, "codex", { hook_event_name: "UserPromptSubmit", session_id: "codex-session" }),
      /not active/,
    );

    agents.setIntegrationEnabled(true);
    const replacement = agents.prepareTerminalSession(first);
    assert.equal(replacement.TERMINAY_AGENT_HOOK_TOKEN, "toggle-token-2");
  } finally {
    await agents.stop();
  }
});

test("terminal sequence cleanup is exact and cannot reset a suffix-colliding active session", async () => {
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  let token = 0;
  const agents = new AgentStatusService({ activity, receiver: { tokenFactory: () => `sequence-token-${++token}` }, now: () => 100 });
  await agents.start();
  try {
    const longer = identity("project-a", "a:b");
    const suffix = identity("project-a", "b");
    agents.register(longer);
    agents.register(suffix);
    await agents.ingestHookPayload(longer, "codex", { hook_event_name: "SessionStart", session_id: "longer-session" });
    await agents.ingestHookPayload(suffix, "codex", { hook_event_name: "SessionStart", session_id: "suffix-session" });
    agents.terminalExited(suffix);
    await agents.ingestHookPayload(longer, "codex", { hook_event_name: "UserPromptSubmit", session_id: "longer-session" });
    const entry = Object.values(agents.getSnapshot().entries).find((candidate) => candidate.activationTerminalSessionId === "a:b");
    assert.equal(entry?.lastEventSequence, 2);
    assert.equal(entry?.state, "working");
  } finally {
    await agents.stop();
  }
});

test("receiver and service reject cross-project hook use, unknown events, and stale terminal sessions", async () => {
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  let tokenCounter = 0;
  const agents = new AgentStatusService({ activity, receiver: { tokenFactory: () => `scoped-token-${++tokenCounter}` }, now: () => 100 });
  await agents.start();
  try {
    const first = identity("project-a", "session-a");
    const second = identity("project-b", "session-b");
    agents.register(first);
    agents.register(second);
    const lease = agents.receiver.register(first);
    const headers = {
      [AGENT_HOOK_TOKEN_HEADER]: lease.token,
      [AGENT_HOOK_SESSION_HEADER]: lease.sessionId,
      [AGENT_HOOK_PROJECT_HEADER]: "project-b",
      [AGENT_HOOK_SERVER_HEADER]: lease.serverId,
      "x-terminay-agent-provider": "codex",
    };
    const crossProject = await agents.receiver.handle({ method: "POST", path: AGENT_HOOK_PATH, remoteAddress: "127.0.0.1", contentType: "application/json", headers, body: JSON.stringify({ hook_event_name: "UserPromptSubmit" }) });
    assert.equal(crossProject.statusCode, 403);
    assert.rejects(() => agents.ingestHookPayload({ ...first, projectId: "project-b" }, "codex", { hook_event_name: "UserPromptSubmit" }), /not active/);
    assert.equal(await agents.ingestHookPayload(first, "codex", { hook_event_name: "SessionStart", session_id: "codex-session" }), true);
    assert.equal(await agents.ingestHookPayload(first, "codex", { hook_event_name: "UnsupportedProviderEvent" }), false);
    agents.terminalExited(first);
    assert.rejects(() => agents.ingestHookPayload(first, "codex", { hook_event_name: "UserPromptSubmit" }), /not active/);
    assert.equal(agents.getSnapshot().entries[Object.keys(agents.getSnapshot().entries)[0]]?.active, false);
    assert.equal(agents.getSnapshot().entries[Object.keys(agents.getSnapshot().entries)[0]]?.activationTerminalSessionId, "session-a");
    assert.equal(agents.getSnapshot().entries[Object.keys(agents.getSnapshot().entries)[0]]?.provider, "codex");
    void second;
  } finally {
    await agents.stop();
  }
});

test("subagent lifecycle remains under its root and terminal exit is isolated", async () => {
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  let tokenCounter = 0;
  const agents = new AgentStatusService({ activity, receiver: { tokenFactory: () => `subagent-token-${++tokenCounter}` }, now: () => 100 });
  await agents.start();
  try {
    const first = identity("project-a", "session-a");
    const second = identity("project-a", "session-b");
    agents.register(first);
    agents.register(second);
    await agents.ingestHookPayload(first, "claude-code", { hook_event_name: "SessionStart", session_id: "claude-a" });
    await agents.ingestHookPayload(first, "claude-code", { hook_event_name: "SubagentStart", session_id: "claude-a", subagent_id: "child-a", parent_agent_id: "claude-a", task_name: "inspect" });
    await agents.ingestHookPayload(second, "claude-code", { hook_event_name: "SessionStart", session_id: "claude-b" });
    const entries = Object.values(agents.getSnapshot().entries);
    const child = entries.find((entry) => entry.kind === "subagent");
    assert.equal(child.parentAgentId, "claude-a");
    assert.equal(child.activationTerminalSessionId, "session-a");
    agents.terminalExited(first);
    const after = Object.values(agents.getSnapshot().entries);
    assert.equal(after.filter((entry) => entry.activationTerminalSessionId === "session-a" && entry.active).length, 0);
    assert.equal(after.find((entry) => entry.activationTerminalSessionId === "session-b")?.active, true);
  } finally {
    await agents.stop();
  }
});

test("activity navigation targets stay authorized to their exact project and session", async () => {
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  let tokenCounter = 0;
  const agents = new AgentStatusService({ activity, receiver: { tokenFactory: () => `navigation-token-${++tokenCounter}` }, now: () => 100 });
  await agents.start();
  try {
    const first = identity("project-a", "session-a");
    const sibling = identity("project-a", "session-b");
    const otherProject = identity("project-b", "session-c");
    agents.register(first);
    agents.register(sibling);
    agents.register(otherProject);

    await agents.ingestHookPayload(first, "codex", { hook_event_name: "SessionStart", session_id: "codex-a" });
    await agents.ingestHookPayload(first, "codex", { hook_event_name: "UserPromptSubmit", session_id: "codex-a" });
    await agents.ingestHookPayload(first, "codex", { hook_event_name: "PermissionRequest", session_id: "codex-a", reason: "allow command" });
    await agents.ingestHookPayload(sibling, "codex", { hook_event_name: "SessionStart", session_id: "codex-b" });
    await agents.ingestHookPayload(otherProject, "codex", { hook_event_name: "SessionStart", session_id: "codex-c" });

    const entries = Object.values(agents.getSnapshot().entries);
    const firstEntry = entries.find((entry) => entry.kind === "root" && entry.activationTerminalSessionId === "session-a");
    const siblingEntry = entries.find((entry) => entry.kind === "root" && entry.activationTerminalSessionId === "session-b");
    const otherProjectEntry = entries.find((entry) => entry.kind === "root" && entry.activationTerminalSessionId === "session-c");
    assert.ok(firstEntry);
    assert.ok(siblingEntry);
    assert.ok(otherProjectEntry);

    // A UI navigation target is the server-owned identity carried by the
    // entry. It must resolve only to the project/session that created it.
    assert.equal(firstEntry.terminalSessionId, "session-a");
    assert.equal(activity.get({ serverId: "server-a", projectId: "project-a", sessionId: firstEntry.activationTerminalSessionId })?.projectId, "project-a");
    assert.throws(
      () => activity.get({ serverId: "server-a", projectId: "project-b", sessionId: firstEntry.activationTerminalSessionId }),
      (error) => error instanceof Error && error.code === "project_mismatch",
    );

    // A sibling session cannot acknowledge or retarget the first session's
    // entry, even though both sessions belong to the same project.
    assert.equal(agents.acknowledge(sibling, firstEntry.entryId), false);
    assert.equal(agents.acknowledge(first, siblingEntry.entryId), false);
    assert.equal(agents.getSnapshot().entries[firstEntry.entryId].unread, true);

    // A forged project identity for the same session is rejected before it
    // can acknowledge the entry, and the session cannot be rebound elsewhere.
    assert.throws(() => agents.acknowledge({ ...first, projectId: "project-b" }, firstEntry.entryId), /not active/);
    assert.throws(() => agents.register({ ...first, projectId: "project-b" }), /already bound/);
    assert.equal(agents.getSnapshot().entries[firstEntry.entryId].unread, true);

    assert.equal(agents.acknowledge(first, firstEntry.entryId), true);
    assert.equal(agents.getSnapshot().entries[firstEntry.entryId].unread, false);
    assert.equal(agents.getSnapshot().entries[otherProjectEntry.entryId].activationTerminalSessionId, "session-c");
  } finally {
    await agents.stop();
  }
});

test("server-owned agent lifecycle correlates subagent launches and retires a foreground provider after shell return", async () => {
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  const agents = new AgentStatusService({ activity, now: () => 100, foregroundExitConfirmationMs: 0 });
  await agents.start();
  try {
    const terminal = identity("project-a", "session-a");
    agents.register(terminal);
    await agents.ingestHookPayload(terminal, "codex", { hook_event_name: "SessionStart", session_id: "codex-a" });
    await agents.ingestHookPayload(terminal, "codex", { hook_event_name: "PreToolUse", session_id: "codex-a", tool_name: "Task", tool_use_id: "task-1", tool_input: { task_name: "review", prompt: "inspect the server" } });
    await agents.ingestHookPayload(terminal, "codex", { hook_event_name: "SubagentStart", session_id: "codex-a", subagent_id: "child-a" });
    const child = Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "subagent");
    assert.equal(child?.displayName, "review");
    assert.equal(child?.promptText, "inspect the server");

    agents.foregroundProcessChanged(terminal, "codex", false);
    agents.foregroundProcessChanged(terminal, "zsh", true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const root = Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "root");
    assert.equal(root?.active, false);
    assert.equal(root?.lastEventKind, "session.stopped");
  } finally {
    await agents.stop();
  }
});

test("server-owned agent lifecycle resolves a Codex subagent name from bounded transcript metadata", async () => {
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  const agents = new AgentStatusService({ activity, now: () => 100 });
  const directory = await mkdtemp(join(tmpdir(), "terminay-codex-transcript-"));
  const transcriptPath = join(directory, "child.jsonl");
  await agents.start();
  try {
    await writeFile(transcriptPath, `${JSON.stringify({ type: "session_meta", payload: { source: { subagent: { thread_spawn: { agent_path: "/root/math_question_one" } } } } })}\n`);
    const terminal = identity("project-a", "session-a");
    agents.register(terminal);
    await agents.ingestHookPayload(terminal, "codex", { hook_event_name: "UserPromptSubmit", session_id: "root", prompt: "Spawn one named math agent" });
    await agents.ingestHookPayload(terminal, "codex", { hook_event_name: "SubagentStart", session_id: "root", agent_id: "child-math", agent_type: "default", transcript_path: transcriptPath });
    const child = Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "subagent");
    assert.equal(child?.displayName, "math_question_one");
  } finally {
    await agents.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a provider hook cancels pending foreground shell-return retirement", async () => {
  const activity = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  const agents = new AgentStatusService({ activity, now: () => 100, foregroundExitConfirmationMs: 25 });
  await agents.start();
  try {
    const terminal = identity("project-a", "session-a");
    agents.register(terminal);
    await agents.ingestHookPayload(terminal, "codex", {
      hook_event_name: "SessionStart",
      session_id: "codex-a",
    });

    agents.foregroundProcessChanged(terminal, "codex", false);
    agents.foregroundProcessChanged(terminal, "zsh", true);
    await agents.ingestHookPayload(terminal, "codex", {
      hook_event_name: "UserPromptSubmit",
      session_id: "codex-a",
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    const root = Object.values(agents.getSnapshot().entries).find((entry) => entry.kind === "root");
    assert.equal(root?.active, true);
    assert.notEqual(root?.lastEventKind, "session.stopped");
  } finally {
    await agents.stop();
  }
});
