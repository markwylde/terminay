import test from 'node:test';
import assert from 'node:assert/strict';
import { reportTiming } from './ci-run-timing.mjs';
const at = seconds => new Date(Date.UTC(2026, 10, 14) + seconds * 1000).toISOString();
function fixture() {
  return { run: { id: 1, head_sha: 'abc', created_at: at(0), completed_at: at(250), status: 'completed', conclusion: 'success' }, requiredStatuses: ['CI / build', 'CI / shard'], dependencies: { build: [], shard: ['build'] }, jobs: [{ name: 'build', status: 'completed', conclusion: 'success', started_at: at(10), completed_at: at(100) }, { name: 'shard', status: 'completed', conclusion: 'success', started_at: at(120), completed_at: at(240) }], statuses: [{ context: 'CI / build', state: 'success', sha: 'abc', updated_at: at(105) }, { context: 'CI / shard', state: 'success', sha: 'abc', updated_at: at(245) }] };
}
test('includes admission, dependency wait, reporting and teardown in readiness', () => {
  const report = reportTiming(fixture());
  assert.equal(report.creationToGreenSeconds, 250);
  assert.equal(report.meetsBudget, true);
  const shard = report.jobs.find(job => job.name === 'shard');
  assert.equal(shard.dependencyWaitSeconds, 100);
  assert.equal(shard.runnerWaitSeconds, 20);
  assert.equal(shard.executionSeconds, 120);
});
test('latest pending required status prevents stale success from proving green', () => {
  const input = fixture(); input.statuses.push({ context: 'CI / shard', state: 'pending', updated_at: at(260) });
  assert.equal(reportTiming(input).ready, false);
  assert.equal(reportTiming(input).creationToGreenSeconds, null);
});
test('missing requirements, failed jobs, missing contexts and other revisions cannot prove readiness', () => {
  for (const mutate of [input => { input.requiredStatuses = []; }, input => { input.jobs[1].conclusion = 'failure'; }, input => { input.statuses.pop(); }, input => { input.statuses[1].sha = 'other'; }]) {
    const input = fixture(); mutate(input); assert.equal(reportTiming(input).ready, false);
  }
});
test('legitimate skipped jobs and statuses count toward readiness', () => {
  const input = fixture(); input.jobs[1].conclusion = 'skipped'; input.statuses[1].state = 'skipped';
  assert.equal(reportTiming(input).ready, true);
});
test('rerun never resets original creation or fabricates queue duration', () => {
  const input = fixture(); input.run.run_attempt = 2; input.jobs.forEach(job => { job.run_attempt = 2; job.created_at = at(200); });
  let report = reportTiming(input);
  assert.equal(report.creationToGreenSeconds, null); assert.equal(report.meetsBudget, null);
  assert.ok(report.jobs.every(job => job.runnerWaitSeconds === null));
  input.originalCreatedAt = at(-100); input.attempts = [{ attempt: 1, conclusion: 'failure' }];
  report = reportTiming(input);
  assert.equal(report.creationToGreenSeconds, 350); assert.equal(report.meetsBudget, false);
  assert.equal(report.attemptHistory[0].conclusion, 'failure');
});
test('unknown dependencies do not masquerade as runner queues; exact 300 seconds misses target', () => {
  const input = fixture(); delete input.dependencies.shard; input.run.completed_at = at(300);
  const report = reportTiming(input);
  assert.equal(report.jobs.find(job => job.name === 'shard').runnerWaitSeconds, null);
  assert.equal(report.meetsBudget, false);
});

test('CLI consumes captured evidence and prints parseable JSON', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'ci-run-timing-'));
  try {
    const capture = join(directory, 'capture.json');
    await writeFile(capture, JSON.stringify(fixture()));
    const result = JSON.parse(execFileSync(process.execPath, [new URL('./ci-run-timing.mjs', import.meta.url).pathname, capture], { encoding: 'utf8', timeout: 5000 }));
    assert.equal(result.creationToGreenSeconds, 250);
    assert.equal(result.ready, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('fetch handles Gitea status fields and server-clamped pages', async () => {
  const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(join(tmpdir(), 'ci-run-timing-fetch-'));
  try {
    const fixtureData = fixture();
    const responses = {
      '/repos/owner/repo/actions/runs/1': fixtureData.run,
      '/repos/owner/repo/actions/runs/1/jobs?limit=100&page=1': { jobs: fixtureData.jobs },
      '/repos/owner/repo/actions/runs/1/jobs?limit=100&page=2': { jobs: [] },
      '/repos/owner/repo/statuses/abc?limit=100&page=1': [{ ...fixtureData.statuses[0], state: undefined, status: 'success' }],
      '/repos/owner/repo/statuses/abc?limit=100&page=2': [{ ...fixtureData.statuses[1], state: undefined, status: 'success' }],
      '/repos/owner/repo/statuses/abc?limit=100&page=3': [],
    };
    const executable = join(directory, 'tea');
    await writeFile(executable, `#!${process.execPath}\nconst responses=${JSON.stringify(responses)}; const value=responses[process.argv[3]]; if(value===undefined) process.exit(2); process.stdout.write(JSON.stringify(value));\n`);
    await chmod(executable, 0o700);
    const requirements = join(directory, 'requirements.json');
    await writeFile(requirements, JSON.stringify({ requiredStatuses: fixtureData.requiredStatuses, dependencies: fixtureData.dependencies }));
    const report = JSON.parse(execFileSync(process.execPath, [new URL('./ci-run-timing.mjs', import.meta.url).pathname, '--fetch', 'owner/repo', '1', requirements], { encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } }));
    assert.equal(report.ready, true);
    assert.equal(report.checks.length, 2);
    assert.equal(report.creationToGreenSeconds, 250);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
