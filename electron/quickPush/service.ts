import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  QuickPushAction,
  QuickPushApplyRequest,
  QuickPushApplyResult,
  QuickPushApplyStep,
  QuickPushCommit,
  QuickPushGenerateRequest,
  QuickPushPlan,
  QuickPushPullRequest,
} from '../../src/types/terminay'
import { getProviderEnv, type AiTabMetadataService } from '../aiTabMetadata/service'
import { isGithubRemote, parseRemoteWebInfo } from './pullRequest'

const execFileAsync = promisify(execFile)

const MAX_BUFFER = 1024 * 1024 * 16
const MAX_DIFF_CHARS = 60_000
const MAX_FILE_CONTEXT_TOTAL_CHARS = 120_000
const MAX_FILE_CONTEXT_CHARS = 30_000
const GIT_TIMEOUT_MS = 30_000

type PorcelainEntry = {
  x: string
  y: string
  path: string
}

type QuickPushContext = {
  repoRoot: string
  branch: string
  changedFiles: string[]
  statusText: string
  diffText: string
  fileContextText: string
  warnings: string[]
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, limit)}\n… [truncated ${value.length - limit} characters]`
}

/** Parse `git status --porcelain=v1 -z` output into entries (rename source paths are skipped). */
export function parsePorcelain(stdout: string): PorcelainEntry[] {
  const tokens = stdout.split('\0').filter((token) => token.length > 0)
  const entries: PorcelainEntry[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index]
    if (record.length < 4) {
      continue
    }

    const x = record[0]
    const y = record[1]
    const filePath = record.slice(3)

    // Rename/copy records are followed by their original path as a separate token.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      index += 1
    }

    entries.push({ x, y, path: filePath })
  }

  return entries
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0)
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const env = await getProviderEnv()
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env,
    maxBuffer: MAX_BUFFER,
    timeout: GIT_TIMEOUT_MS,
  })
  return stdout
}

function slugifyBranch(message: string): string {
  const slug = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'changes'
}

function actionNeedsBranch(action: QuickPushAction): boolean {
  return action === 'new' || action === 'new-pr'
}

function actionNeedsPullRequest(action: QuickPushAction): boolean {
  return action === 'current-pr' || action === 'new-pr'
}

/**
 * Extract the first balanced top-level JSON object from raw model output and
 * repair the mistakes models commonly make: code fences, raw control characters
 * inside strings (e.g. a multi-line PR body), and trailing commas.
 */
export function extractJsonObject(raw: string): string | null {
  const withoutFences = raw.replace(/```(?:json)?/gi, '')
  const start = withoutFences.indexOf('{')
  if (start === -1) {
    return null
  }

  let depth = 0
  let inString = false
  let escaped = false
  let out = ''
  let closed = false

  for (let index = start; index < withoutFences.length; index += 1) {
    const char = withoutFences[index]

    if (inString) {
      if (escaped) {
        out += char
        escaped = false
      } else if (char === '\\') {
        out += char
        escaped = true
      } else if (char === '"') {
        out += char
        inString = false
      } else if (char === '\n') {
        out += '\\n'
      } else if (char === '\r') {
        out += '\\r'
      } else if (char === '\t') {
        out += '\\t'
      } else {
        out += char
      }
      continue
    }

    out += char

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        closed = true
        break
      }
    }
  }

  if (!closed) {
    return null
  }

  // Drop trailing commas before a closing brace/bracket.
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/**
 * Turn raw model output into a normalized {@link QuickPushPlan}. Pure (no IO) so
 * it can be unit-tested against fixture strings.
 */
export function parseQuickPushPlan(
  raw: string,
  options: { action: QuickPushAction; changedFiles: string[]; warnings?: string[] },
): QuickPushPlan {
  const warnings = [...(options.warnings ?? [])]
  const json = extractJsonObject(raw)
  if (!json) {
    console.warn('[quick-push] No JSON object found in model output:\n', raw.slice(0, 2000))
    throw new Error('The AI did not return a JSON commit plan.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    console.warn(
      '[quick-push] Failed to parse model JSON:',
      error instanceof Error ? error.message : error,
      '\n--- extracted ---\n',
      json.slice(0, 2000),
      '\n--- raw ---\n',
      raw.slice(0, 2000),
    )
    throw new Error('The AI returned a commit plan that was not valid JSON.')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The AI returned a commit plan that was not an object.')
  }

  const root = parsed as Record<string, unknown>
  const knownFiles = new Set(options.changedFiles)
  const assigned = new Set<string>()
  const commits: QuickPushCommit[] = []

  const rawCommits = Array.isArray(root.commits) ? root.commits : []
  for (const entry of rawCommits) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }

    const candidate = entry as Record<string, unknown>
    const message = typeof candidate.message === 'string' ? candidate.message.trim() : ''
    if (!message) {
      continue
    }

    const rawFiles = Array.isArray(candidate.files) ? candidate.files : []
    const files: string[] = []
    for (const file of rawFiles) {
      if (typeof file !== 'string') {
        continue
      }
      const normalized = file.trim()
      if (!normalized) {
        continue
      }
      if (!knownFiles.has(normalized)) {
        warnings.push(`Ignored "${normalized}" in "${message}" — not a changed file.`)
        continue
      }
      if (assigned.has(normalized)) {
        warnings.push(`"${normalized}" was listed in more than one commit; kept the first.`)
        continue
      }
      assigned.add(normalized)
      files.push(normalized)
    }

    if (files.length === 0) {
      warnings.push(`Skipped commit "${message}" — it had no valid changed files.`)
      continue
    }

    commits.push({ message, files })
  }

  const uncoveredFiles = options.changedFiles.filter((file) => !assigned.has(file))

  let branchName: string | null = null
  if (actionNeedsBranch(options.action)) {
    const candidate = typeof root.branchName === 'string' ? root.branchName.trim() : ''
    branchName = candidate || (commits[0] ? slugifyBranch(commits[0].message) : null)
    if (!candidate && branchName) {
      warnings.push(`The AI did not name a branch; using "${branchName}".`)
    }
  }

  let pullRequest: QuickPushPullRequest | null = null
  if (actionNeedsPullRequest(options.action)) {
    const rawPr = root.pullRequest
    if (typeof rawPr === 'object' && rawPr !== null) {
      const prCandidate = rawPr as Record<string, unknown>
      const title = typeof prCandidate.title === 'string' ? prCandidate.title.trim() : ''
      const body = typeof prCandidate.body === 'string' ? prCandidate.body.trim() : ''
      if (title) {
        pullRequest = { title, body }
      }
    }

    if (!pullRequest && commits.length > 0) {
      pullRequest = {
        title: commits[0].message,
        body: commits.map((commit) => `- ${commit.message}`).join('\n'),
      }
      warnings.push('The AI did not provide pull request details; generated them from the commits.')
    }
  }

  return { branchName, pullRequest, commits, uncoveredFiles, warnings }
}

function describeAction(action: QuickPushAction, branch: string): string {
  switch (action) {
    case 'current':
      return `Commit all of the changes onto the current branch "${branch}". Do not set "branchName" or "pullRequest".`
    case 'current-pr':
      return `Commit all of the changes onto the current branch "${branch}", then open a pull request. Set "pullRequest" with a title and body. Do not set "branchName".`
    case 'new':
      return `Commit all of the changes onto a new, descriptively named branch. Set "branchName" to a short kebab-case branch name (you may include a "feat/" or "fix/" style prefix). Do not set "pullRequest".`
    case 'new-pr':
      return `Commit all of the changes onto a new, descriptively named branch, then open a pull request. Set "branchName" to a short kebab-case branch name and set "pullRequest" with a title and body.`
    default:
      return 'Commit all of the changes.'
  }
}

function buildPrompt(context: QuickPushContext, action: QuickPushAction): string {
  return [
    'You are a commit-splitting assistant. Group the working-tree changes below into one or more logical git commits.',
    '',
    'IMPORTANT: Do NOT use any tools. Do NOT explore the filesystem or run commands. Work only from the information given.',
    'Respond with ONLY a JSON object — no markdown code fences, no commentary — in exactly this shape:',
    '',
    '{',
    '  "branchName": string | null,',
    '  "pullRequest": { "title": string, "body": string } | null,',
    '  "commits": [ { "message": string, "files": string[] } ]',
    '}',
    '',
    'Rules:',
    '- Write commit messages in Conventional Commits style (e.g. "feat: …", "fix: …", "chore: …").',
    '- Every changed file listed below must appear in exactly one commit\'s "files" array.',
    '- Use the file paths EXACTLY as shown under "Changed files" (relative to the repo root).',
    '- Group related changes together; split unrelated changes into separate commits.',
    '',
    `Task: ${describeAction(action, context.branch)}`,
    '',
    'Changed files:',
    context.changedFiles.length > 0 ? context.changedFiles.map((file) => `- ${file}`).join('\n') : '(none)',
    '',
    '=== git status ===',
    context.statusText.trim() || '(clean)',
    '',
    '=== git diff (tracked changes) ===',
    context.diffText.trim() || '(no tracked diff)',
    '',
    '=== changed file contents ===',
    context.fileContextText.trim() || '(no readable file contents)',
  ].join('\n')
}

async function buildChangedFileContext(
  repoRoot: string,
  entries: PorcelainEntry[],
  warnings: string[],
): Promise<string> {
  const sections: string[] = []
  let remainingBudget = MAX_FILE_CONTEXT_TOTAL_CHARS

  for (const entry of entries) {
    if (remainingBudget <= 0) {
      sections.push(`--- ${entry.path} (omitted: file context budget exhausted) ---`)
      continue
    }

    const isDeleted = entry.x === 'D' || entry.y === 'D'
    const absolute = path.join(repoRoot, entry.path)

    try {
      const stats = await stat(absolute)
      if (!stats.isFile()) {
        sections.push(`--- ${entry.path} (not a regular file, omitted) ---`)
        continue
      }

      const buffer = await readFile(absolute)
      if (looksBinary(buffer)) {
        sections.push(`--- ${entry.path} (binary, omitted) ---`)
        continue
      }

      const fileBudget = Math.min(MAX_FILE_CONTEXT_CHARS, remainingBudget)
      const text = truncate(buffer.toString('utf8'), fileBudget)
      remainingBudget -= text.length
      sections.push(`--- ${entry.path} ---\n${text}`)
    } catch {
      if (isDeleted) {
        sections.push(`--- ${entry.path} (deleted) ---`)
      } else {
        warnings.push(`Could not read changed file "${entry.path}".`)
      }
    }
  }

  return sections.join('\n\n')
}

async function gatherContext(cwd: string): Promise<QuickPushContext> {
  const warnings: string[] = []

  const repoRoot = (await runGit(['rev-parse', '--show-toplevel'], cwd)).trim()
  if (!repoRoot) {
    throw new Error('Quick Push must be run inside a git repository.')
  }

  let branch = ''
  try {
    branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)).trim()
  } catch {
    branch = ''
  }
  if (!branch || branch === 'HEAD') {
    branch = 'the current branch'
  }

  const porcelain = await runGit(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'],
    repoRoot,
  )
  const entries = parsePorcelain(porcelain)
  const changedFiles = entries.map((entry) => entry.path)

  if (changedFiles.length === 0) {
    throw new Error('There are no changes to commit.')
  }

  const [statusTextRaw, unstaged, staged] = await Promise.all([
    runGit(['-c', 'color.ui=never', 'status'], repoRoot),
    runGit(['-c', 'color.ui=never', 'diff'], repoRoot),
    runGit(['-c', 'color.ui=never', 'diff', '--cached'], repoRoot),
  ])

  const diffParts: string[] = []
  if (staged.trim()) {
    diffParts.push(`# Staged changes\n${staged}`)
  }
  if (unstaged.trim()) {
    diffParts.push(`# Unstaged changes\n${unstaged}`)
  }
  const diffText = truncate(diffParts.join('\n\n'), MAX_DIFF_CHARS)

  const fileContextText = await buildChangedFileContext(repoRoot, entries, warnings)

  return {
    repoRoot,
    branch,
    changedFiles,
    statusText: statusTextRaw,
    diffText,
    fileContextText,
    warnings,
  }
}

function pickRemote(remotes: string): string | null {
  const names = remotes
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  if (names.length === 0) {
    return null
  }
  return names.includes('origin') ? 'origin' : names[0]
}

function extractUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/\S+/g)
  if (!matches || matches.length === 0) {
    return null
  }
  return matches[matches.length - 1].replace(/[).,]+$/, '')
}

async function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    env: await getProviderEnv(),
    maxBuffer: MAX_BUFFER,
    timeout: GIT_TIMEOUT_MS,
  })
  return `${stdout}${stderr}`.trim()
}

function commandErrorMessage(error: unknown, missingMessage: string): string {
  const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string }
  if (err.code === 'ENOENT') {
    return missingMessage
  }
  return err.stderr?.trim() || err.stdout?.trim() || (error instanceof Error ? error.message : String(error))
}

function buildManualPullRequestMessage(remoteUrl: string, branch: string | null, reason?: string): string | null {
  const webUrl = parseRemoteWebInfo(remoteUrl).webUrl
  if (!webUrl) {
    return null
  }

  const branchText = branch && branch !== 'HEAD' ? ` from branch "${branch}"` : ''
  const reasonText = reason ? `Could not create the pull request automatically: ${reason}\n\n` : ''
  return `${reasonText}Create a pull request manually${branchText} at ${webUrl}`
}

async function isCliInstalled(command: string, cwd: string): Promise<boolean> {
  try {
    await runCommand(command, ['--version'], cwd)
    return true
  } catch (error) {
    // ENOENT means the binary isn't on PATH. Any other failure (e.g. a
    // non-zero exit from `--version`) still implies the CLI is present.
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

// Ask gh whether it considers the current repo a GitHub repo. This also
// covers GitHub Enterprise hosts that a hostname check would miss.
async function ghRecognizesRepo(cwd: string): Promise<boolean> {
  try {
    await runCommand('gh', ['repo', 'view', '--json', 'url'], cwd)
    return true
  } catch {
    return false
  }
}

// Ask tea whether it has a login configured for the remote's host. We request
// CSV output because tea's default table output truncates long URLs/hosts,
// which made a plain substring match miss legitimate Gitea remotes.
async function teaRecognizesRepo(remoteUrl: string, cwd: string): Promise<boolean> {
  const host = parseRemoteWebInfo(remoteUrl).host?.toLowerCase()
  if (!host) {
    return false
  }

  try {
    const output = await runCommand('tea', ['logins', 'list', '--output', 'csv'], cwd)
    return output.toLowerCase().includes(host)
  } catch {
    return false
  }
}

type PullRequestProvider = 'gh' | 'tea'

// Decide which CLI (if any) can open a pull request for this remote. We only
// consider tools that are installed, then test gh first (GitHub) and tea
// second (Gitea), ignoring a tool that doesn't recognize the repo.
async function detectPullRequestProvider(remoteUrl: string, cwd: string): Promise<PullRequestProvider | null> {
  if (await isCliInstalled('gh', cwd)) {
    if (isGithubRemote(remoteUrl) || (await ghRecognizesRepo(cwd))) {
      return 'gh'
    }
  }

  if (await isCliInstalled('tea', cwd)) {
    if (await teaRecognizesRepo(remoteUrl, cwd)) {
      return 'tea'
    }
  }

  return null
}

export class QuickPushService {
  constructor(private readonly aiTabMetadataService: AiTabMetadataService) {}

  async generatePlan(request: QuickPushGenerateRequest): Promise<QuickPushPlan> {
    const context = await gatherContext(request.cwd)
    const prompt = buildPrompt(context, request.action)
    const raw = await this.aiTabMetadataService.runPrompt({
      provider: request.provider,
      model: request.model,
      prompt,
      cwd: context.repoRoot,
    })

    return parseQuickPushPlan(raw, {
      action: request.action,
      changedFiles: context.changedFiles,
      warnings: context.warnings,
    })
  }

  async apply(request: QuickPushApplyRequest): Promise<QuickPushApplyResult> {
    const steps: QuickPushApplyStep[] = []
    let pushed = false
    let pullRequestUrl: string | null = null
    let pullRequestUrlLabel: string | null = null
    let branch: string | null = null

    const repoRoot = (await runGit(['rev-parse', '--show-toplevel'], request.cwd)).trim()

    const run = async (label: string, args: string[]): Promise<string> => {
      try {
        const env = await getProviderEnv()
        const { stdout, stderr } = await execFileAsync('git', args, {
          cwd: repoRoot,
          env,
          maxBuffer: MAX_BUFFER,
          timeout: GIT_TIMEOUT_MS,
        })
        const output = `${stdout}${stderr}`.trim()
        steps.push({ label, ok: true, output: output || undefined })
        return stdout
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        steps.push({ label, ok: false, output: message })
        throw new Error(message)
      }
    }

    try {
      if (request.commits.length === 0) {
        throw new Error('There are no commits to apply.')
      }

      if (request.action === 'new' || request.action === 'new-pr') {
        const branchName = request.branchName?.trim()
        if (!branchName) {
          throw new Error('A branch name is required to push to a new branch.')
        }
        await run(`Create branch ${branchName}`, ['checkout', '-b', branchName])
        branch = branchName
      } else {
        branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)).trim()
      }

      for (const commit of request.commits) {
        const shortMessage = commit.message.split('\n')[0]
        await run(`Stage: ${shortMessage}`, ['add', '--', ...commit.files])
        await run(`Commit: ${shortMessage}`, ['commit', '-m', commit.message, '--', ...commit.files])
      }

      const remote = pickRemote(await runGit(['remote'], repoRoot))
      if (!remote) {
        throw new Error('No git remote is configured to push to.')
      }

      const pushTarget = branch && branch !== 'HEAD' ? branch : 'HEAD'
      await run(`Push to ${remote}`, ['push', '-u', remote, pushTarget])
      pushed = true

      if (request.action === 'current-pr' || request.action === 'new-pr') {
        const pr = request.pullRequest
        if (!pr?.title.trim()) {
          throw new Error('Pull request details are missing.')
        }
        const remoteUrl = (await runGit(['remote', 'get-url', remote], repoRoot)).trim()
        const provider = await detectPullRequestProvider(remoteUrl, repoRoot)

        if (provider === 'gh') {
          try {
            const output = await runCommand(
              'gh',
              ['pr', 'create', '--title', pr.title, '--body', pr.body ?? '', '--head', pushTarget],
              repoRoot,
            )
            pullRequestUrl = extractUrl(output)
            pullRequestUrlLabel = 'View pull request'
            steps.push({ label: 'Open pull request with gh', ok: true, output: output || undefined })
          } catch (error) {
            const message = commandErrorMessage(error, 'GitHub CLI (gh) is not installed or not on PATH.')
            const fallback = buildManualPullRequestMessage(remoteUrl, pushTarget, message)
            if (!fallback) {
              steps.push({ label: 'Open pull request with gh', ok: false, output: message })
              throw new Error(message)
            }
            pullRequestUrl = parseRemoteWebInfo(remoteUrl).webUrl
            pullRequestUrlLabel = 'Create pull request'
            steps.push({ label: 'Create pull request manually', ok: true, output: fallback })
          }
        } else if (provider === 'tea') {
          try {
            const output = await runCommand(
              'tea',
              [
                'pulls',
                'create',
                '--remote',
                remote,
                '--head',
                pushTarget,
                '--title',
                pr.title,
                '--description',
                pr.body ?? '',
              ],
              repoRoot,
            )
            pullRequestUrl = extractUrl(output)
            pullRequestUrlLabel = 'View pull request'
            steps.push({ label: 'Open pull request with tea', ok: true, output: output || undefined })
          } catch (error) {
            const message = commandErrorMessage(error, 'Gitea CLI (tea) is not installed or not on PATH.')
            const fallback = buildManualPullRequestMessage(remoteUrl, pushTarget, message)
            if (!fallback) {
              steps.push({ label: 'Open pull request with tea', ok: false, output: message })
              throw new Error(message)
            }
            pullRequestUrl = parseRemoteWebInfo(remoteUrl).webUrl
            pullRequestUrlLabel = 'Create pull request'
            steps.push({ label: 'Create pull request manually', ok: true, output: fallback })
          }
        } else {
          const fallback = buildManualPullRequestMessage(remoteUrl, pushTarget)
          if (!fallback) {
            throw new Error(
              'No installed CLI (gh or tea) recognized this remote, and it has no usable web URL for a pull request.',
            )
          }
          pullRequestUrl = parseRemoteWebInfo(remoteUrl).webUrl
          pullRequestUrlLabel = 'Create pull request'
          steps.push({ label: 'Create pull request manually', ok: true, output: fallback })
        }
      }

      return { ok: true, steps, branch, pushed, pullRequestUrl, pullRequestUrlLabel, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, steps, branch, pushed, pullRequestUrl, pullRequestUrlLabel, error: message }
    }
  }
}
