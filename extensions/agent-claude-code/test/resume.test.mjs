import assert from "node:assert/strict";
import test from "node:test";
import { claudeProjectJournalPath, claudeResumeSessionId } from "../dist/index.js";

const sessionId = "5f2aff08-eab3-4852-96eb-48235fc7f471";

test("Claude Code only accepts explicit valid native --resume identities", () => {
  assert.equal(claudeResumeSessionId(["--resume", sessionId]), sessionId);
  assert.equal(claudeResumeSessionId([`--resume=${sessionId}`]), sessionId);
  assert.equal(claudeResumeSessionId(["-r", sessionId]), sessionId);
  assert.equal(claudeResumeSessionId(["--resume", "not-a-session"]), undefined);
  assert.equal(claudeResumeSessionId(undefined), undefined);
});

test("Claude Code derives only the provider-owned project journal path", () => {
  assert.equal(claudeProjectJournalPath("/work/acme.github.io", sessionId), `.claude/projects/-work-acme-github-io/${sessionId}.jsonl`);
  assert.equal(claudeProjectJournalPath("relative/project", sessionId), undefined);
  assert.equal(claudeProjectJournalPath("/work/acme", "not-a-session"), undefined);
});
