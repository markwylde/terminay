import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  TerminayClient,
  TerminayClientFacade,
  TerminayGitClient,
} from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  createServerCore,
  GitQuickPushService,
  GitService,
  ServerGitAdapter,
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

test("framed TerminayGitClient exercises server-owned status, diff, worktree, default branch, and PR semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-git-framed-client-"));
  let client;
  let serverTask;
  try {
    await initialise(root);
    const git = new GitService();
    const binding = await git.bindProject("project-a", root);
    const executed = [];
    const quickPush = new GitQuickPushService(
      git,
      {
        plan: async (context) => {
          assert.equal(context.branch, "main");
          return {
            actions: [
              {
                kind: "push",
                target: "main",
                summary: "Push the reviewed branch",
                mutatesRevision: false,
              },
              {
                kind: "pull-request",
                target: "main",
                summary: "Open the reviewed pull request",
                mutatesRevision: false,
              },
            ],
          };
        },
      },
      {
        execute: async (action) => {
          executed.push(action);
          return { applied: true, detail: `${action.kind} completed` };
        },
      },
    );
    const adapter = new ServerGitAdapter({
      serverId: "server-a",
      git,
      quickPush,
    });
    const operations = adapter.operations();
    const pair = createInMemoryTransportPair();
    const server = createServerCore({
      serverId: "server-a",
      serverVersion: "test",
      capabilities: ["git"],
      authenticate: ({ hello }) => ({
        clientId: hello.clientId,
        authScope: "write",
        claims: { projectId: "project-a" },
      }),
      defaultQueryScope: "read",
      defaultCommandScope: "write",
      queries: operations.queries,
      commands: operations.commands,
    }).accept(pair.server);
    serverTask = server.start();
    await pair.open();
    const protocolClient = new TerminayClient({
      transport: pair.client,
      clientId: "client-a",
      capabilities: ["git"],
    });
    client = protocolClient;
    await protocolClient.connect();
    const gitClient = new TerminayGitClient(new TerminayClientFacade(protocolClient));
    const reference = {
      projectId: "project-a",
      repositoryId: binding.repositoryId,
      worktreeId: binding.worktreeId,
    };

    const status = await gitClient.status(reference);
    assert.equal(status.state, "ready");
    assert.equal(status.branch.name, "main");
    assert.equal(status.entries.length, 0);

    const branch = await gitClient.branch(reference);
    assert.equal(branch.branch.name, "main");
    assert.equal(branch.head, status.head);

    const diff = await gitClient.diff(reference);
    assert.equal(diff.state, "ready");
    assert.equal(diff.compareTarget, "HEAD");
    assert.equal(diff.files.length, 0);

    const worktrees = await gitClient.list({
      projectId: reference.projectId,
      repositoryId: reference.repositoryId,
    });
    assert.equal(worktrees.defaultBranch, "main");
    assert.equal(worktrees.worktrees.length, 1);
    assert.equal(worktrees.worktrees[0].id, reference.worktreeId);

    const proposal = await gitClient.proposeQuickPush({
      ...reference,
      provider: "fixture-provider",
    });
    assert.equal(proposal.targetBranch, "main");
    assert.deepEqual(proposal.actions.map((action) => action.kind), ["push", "pull-request"]);

    const approval = await gitClient.approveQuickPush({
      proposalId: proposal.proposalId,
      revision: proposal.revision,
      actionDigest: proposal.actionDigest,
    });
    assert.equal(approval.applied, true);
    assert.equal(approval.partialFailure, false);
    assert.deepEqual(executed.map((action) => action.kind), ["push", "pull-request"]);
  } finally {
    await client?.close().catch(() => undefined);
    await serverTask?.catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

async function initialise(root) {
  await mkdir(root, { recursive: true });
  await git(["init", "-b", "main"], root);
  await git(["config", "user.email", "test@example.invalid"], root);
  await git(["config", "user.name", "Terminay Test"], root);
  await writeFile(join(root, "file.txt"), "base\n");
  await git(["add", "file.txt"], root);
  await git(["commit", "-m", "initial"], root);
}

async function git(args, cwd) {
  await execFileAsync("git", args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}
