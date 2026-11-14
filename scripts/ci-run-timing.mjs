#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const seconds = (start, end) => start !== null && end !== null && end >= start ? (end - start) / 1000 : null;
const accepted = value => ['success', 'skipped'].includes(value);

/** Analyze captured API evidence without treating a rerun as a fresh run. */
export function reportTiming(input) {
  const { run = {}, dependencies = {} } = input;
  const jobs = Array.isArray(input.jobs) ? input.jobs : input.jobs?.jobs ?? [];
  const statuses = Array.isArray(input.statuses) ? input.statuses : input.statuses?.statuses ?? [];
  const required = input.requiredStatuses ?? [];
  const warnings = [];
  const attempt = Math.max(run.run_attempt ?? 1, ...jobs.map(job => job.run_attempt ?? 1));
  const retried = attempt > 1;
  const original = time(input.originalCreatedAt ?? (!retried ? run.created_at : null));
  if (original === null) warnings.push('Original creation time is missing or unproven; supply originalCreatedAt captured before retries.');
  if (retried) {
    warnings.push('Retry evidence may preserve earlier job timestamps; queue waits are not inferred across attempts.');
    if (!input.attempts?.length) warnings.push('Earlier attempt history was not supplied; previous failures may be absent from the API snapshot.');
  }
  if (!required.length) warnings.push('Required status contexts were not supplied; readiness cannot be proven.');
  const newest = new Map();
  for (const status of statuses) {
    const previous = newest.get(status.context);
    if (!previous || (time(status.updated_at ?? status.created_at) ?? 0) > (time(previous.updated_at ?? previous.created_at) ?? 0) || ((status.id ?? 0) > (previous.id ?? 0) && (time(status.updated_at ?? status.created_at) ?? 0) === (time(previous.updated_at ?? previous.created_at) ?? 0))) newest.set(status.context, status);
  }
  const checks = required.map(context => {
    const status = newest.get(context);
    return { context, state: status?.state ?? status?.status ?? 'missing', completion: status?.updated_at ?? status?.created_at ?? null, revisionMatches: Boolean(status && (!status.sha || status.sha === run.head_sha)) };
  });
  const jobReports = jobs.map(job => {
    const start = time(job.started_at), end = time(job.completed_at);
    const needs = dependencies[job.name];
    let ready = null;
    if (!retried && Array.isArray(needs) && original !== null) {
      const parents = needs.map(name => jobs.find(candidate => candidate.name === name));
      if (parents.every(parent => parent && parent.status === 'completed' && accepted(parent.conclusion) && time(parent.completed_at) !== null)) ready = Math.max(original, ...parents.map(parent => time(parent.completed_at)));
    }
    if (start !== null && end !== null && end < start) warnings.push(`Invalid timestamps for ${job.name}.`);
    return { id: job.id, name: job.name, runner: job.runner_name ?? null, attempt: job.run_attempt ?? 1, status: job.status, conclusion: job.conclusion, executionSeconds: seconds(start, end), dependencyWaitSeconds: seconds(original, ready), runnerWaitSeconds: seconds(ready, start), startedAt: job.started_at ?? null, completedAt: job.completed_at ?? null };
  });
  const jobsComplete = jobs.length > 0 && jobs.every(job => job.status === 'completed' && accepted(job.conclusion) && time(job.completed_at) !== null);
  const checksComplete = checks.length > 0 && checks.every(check => accepted(check.state) && check.revisionMatches && time(check.completion) !== null);
  const ready = jobsComplete && checksComplete && run.status === 'completed' && accepted(run.conclusion);
  const completion = ready ? Math.max(...jobs.map(job => time(job.completed_at)), ...checks.map(check => time(check.completion)), time(run.completed_at) ?? 0) : null;
  const elapsed = seconds(original, completion);
  if (completion !== null && original !== null && completion < original) warnings.push('Final completion predates original creation.');
  return { schemaVersion: 1, runId: run.id ?? null, headSha: run.head_sha ?? null, attempt, originalCreatedAt: original === null ? null : new Date(original).toISOString(), ready, creationToGreenSeconds: elapsed, budgetSeconds: 300, meetsBudget: ready && elapsed !== null ? elapsed < 300 : null, checks, jobs: jobReports.sort((a, b) => (b.executionSeconds ?? -1) - (a.executionSeconds ?? -1)), warnings, attemptHistory: input.attempts ?? null, fleet: input.fleet ?? null, cacheConditions: input.cacheConditions ?? null };
}

function api(endpoint) {
  return JSON.parse(execFileSync('tea', ['api', endpoint], { encoding: 'utf8', timeout: 20000, maxBuffer: 20 * 1024 * 1024 }));
}
function pages(endpoint, key) {
  const values = [];
  for (let page = 1; page <= 20; page++) {
    const response = api(`${endpoint}?limit=100&page=${page}`);
    const batch = key ? response[key] : response;
    if (!Array.isArray(batch)) throw new Error(`Unexpected response for ${endpoint}`);
    values.push(...batch);
    if (batch.length === 0) return values;
  }
  throw new Error(`Pagination limit exceeded for ${endpoint}; refusing partial evidence.`);
}
export async function main(args) {
  let input;
  if (args[0] === '--fetch') {
    const [, repository, runId, requirementsFile] = args;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^\d+$/.test(runId ?? '') || !requirementsFile) throw new Error('Usage: --fetch OWNER/REPO RUN_ID REQUIREMENTS.json');
    const base = `/repos/${repository}`;
    const requirements = JSON.parse(await readFile(requirementsFile, 'utf8'));
    const run = api(`${base}/actions/runs/${runId}`);
    input = { ...requirements, run, jobs: pages(`${base}/actions/runs/${runId}/jobs`, 'jobs'), statuses: pages(`${base}/statuses/${run.head_sha}`) };
  } else {
    if (args.length !== 1) throw new Error('Usage: ci-run-timing.mjs CAPTURE.json | --fetch OWNER/REPO RUN_ID REQUIREMENTS.json');
    input = JSON.parse(await readFile(args[0], 'utf8'));
  }
  process.stdout.write(`${JSON.stringify(reportTiming(input), null, 2)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
