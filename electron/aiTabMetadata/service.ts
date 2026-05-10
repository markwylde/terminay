import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  AiTabMetadataGenerateRequest,
  AiTabMetadataGenerateResult,
  AiTabMetadataModel,
  AiTabMetadataProvider,
  AiTabMetadataTarget,
} from '../../src/types/terminay'

const execFileAsync = promisify(execFile)
const PROVIDER_TIMEOUT_MS = 90_000
const MODEL_LIST_TIMEOUT_MS = 15_000
const MAX_PROVIDER_BUFFER = 1024 * 1024 * 8
const MAX_CONTEXT_CHARS = 20_000
const MAX_TITLE_CHARS = 64
const MAX_NOTE_CHARS = 1200
const SHELL_ENV_TIMEOUT_MS = 5_000
const SHELL_ENV_START_MARKER = '__TERMINAY_SHELL_ENV_START__'
const SHELL_ENV_END_MARKER = '__TERMINAY_SHELL_ENV_END__'
const COMMON_PROVIDER_PATH_DIRS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), 'bin'),
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]
const DEFAULT_CLAUDE_CODE_MODELS: AiTabMetadataModel[] = [
  { id: 'haiku', label: 'Claude Haiku' },
  { id: 'sonnet', label: 'Claude Sonnet' },
  { id: 'opus', label: 'Claude Opus' },
]

type CodexCatalog = {
  models?: Array<{
    display_name?: string
    priority?: number
    slug?: string
    visibility?: string
  }>
}

type AiTabMetadataTestMock = {
  error?: string | null
  models?: AiTabMetadataModel[]
  noteResult?: string
  titleResult?: string
}

type ShellEnv = Record<string, string>

let providerEnvPromise: Promise<NodeJS.ProcessEnv> | null = null

function getCodexCommand(): string {
  return process.env.TERMINAY_CODEX_COMMAND?.trim() || 'codex'
}

function getClaudeCodeCommand(): string {
  return process.env.TERMINAY_CLAUDE_CODE_COMMAND?.trim() || 'claude'
}

function getConfiguredModels(options: {
  fallback?: AiTabMetadataModel[]
  modelsJsonEnv: string
  singleModelEnv: string
}): AiTabMetadataModel[] | null {
  const modelsJson = process.env[options.modelsJsonEnv]?.trim()
  if (modelsJson) {
    let parsed: unknown
    try {
      parsed = JSON.parse(modelsJson) as unknown
    } catch {
      throw new Error(`${options.modelsJsonEnv} must contain valid JSON.`)
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`${options.modelsJsonEnv} must be a JSON array.`)
    }

    const models = parsed
      .map((model) => {
        if (typeof model === 'string') {
          return { id: model.trim(), label: model.trim() }
        }

        if (typeof model === 'object' && model !== null) {
          const candidate = model as { id?: unknown; label?: unknown }
          const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
          const label = typeof candidate.label === 'string' ? candidate.label.trim() : id
          return id ? { id, label: label || id } : null
        }

        return null
      })
      .filter((model): model is AiTabMetadataModel => model !== null)

    if (models.length === 0) {
      throw new Error(`${options.modelsJsonEnv} did not contain any usable models.`)
    }

    return models
  }

  const model = process.env[options.singleModelEnv]?.trim()
  if (model) {
    return [{ id: model, label: model }]
  }

  return options.fallback ?? null
}

function getConfiguredCodexModels(): AiTabMetadataModel[] | null {
  return getConfiguredModels({
    modelsJsonEnv: 'TERMINAY_CODEX_MODELS_JSON',
    singleModelEnv: 'TERMINAY_CODEX_TEST_MODEL',
  })
}

function getConfiguredClaudeCodeModels(): AiTabMetadataModel[] {
  return getConfiguredModels({
    fallback: DEFAULT_CLAUDE_CODE_MODELS,
    modelsJsonEnv: 'TERMINAY_CLAUDE_CODE_MODELS_JSON',
    singleModelEnv: 'TERMINAY_CLAUDE_CODE_TEST_MODEL',
  }) ?? DEFAULT_CLAUDE_CODE_MODELS
}

function isExecError(error: unknown): error is NodeJS.ErrnoException & {
  killed?: boolean
  signal?: NodeJS.Signals
  stderr?: string
  stdout?: string
} {
  return typeof error === 'object' && error !== null
}

function getCandidateShells(): string[] {
  if (process.platform === 'win32') {
    return []
  }

  return [
    process.env.SHELL?.trim() || '',
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
    '/opt/homebrew/bin/fish',
    '/usr/local/bin/fish',
    '/usr/bin/fish',
  ].filter((value, index, list) => value.length > 0 && list.indexOf(value) === index)
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function buildEnvCaptureCommand(startupFiles: string[]): string {
  const sourceCommands = startupFiles
    .map((startupFile) => {
      const quotedFile = shellSingleQuote(startupFile)
      return `terminay_startup_file=${quotedFile}; if [ -r "$terminay_startup_file" ]; then . "$terminay_startup_file"; fi`
    })
    .join('\n')

  return [
    sourceCommands,
    `printf '%s\\n' ${shellSingleQuote(SHELL_ENV_START_MARKER)}`,
    'env',
    `printf '%s\\n' ${shellSingleQuote(SHELL_ENV_END_MARKER)}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

function getShellStartupFiles(shellPath: string): string[] {
  const shellName = path.basename(shellPath).toLowerCase()
  const home = os.homedir()

  if (shellName === 'zsh') {
    return ['.zshenv', '.zprofile', '.zshrc', '.zlogin'].map((filename) => path.join(home, filename))
  }

  if (shellName === 'bash') {
    return ['.bash_profile', '.bash_login', '.profile', '.bashrc'].map((filename) => path.join(home, filename))
  }

  if (shellName === 'sh' || shellName === 'ksh') {
    return ['.profile'].map((filename) => path.join(home, filename))
  }

  return []
}

function getShellEnvArgs(shellPath: string): string[] {
  const shellName = path.basename(shellPath).toLowerCase()
  const startupFiles = getShellStartupFiles(shellPath)
  const command = buildEnvCaptureCommand(startupFiles)

  if (shellName === 'bash') {
    return ['--noprofile', '--norc', '-ic', command]
  }

  if (shellName === 'zsh') {
    return ['-f', '-ic', command]
  }

  if (shellName === 'fish') {
    return [
      '-lic',
      [
        `printf '%s\\n' ${shellSingleQuote(SHELL_ENV_START_MARKER)}`,
        'env',
        `printf '%s\\n' ${shellSingleQuote(SHELL_ENV_END_MARKER)}`,
      ].join('; '),
    ]
  }

  if (['sh', 'ksh'].includes(shellName)) {
    return ['-lc', command]
  }

  return ['-lc', command]
}

function parseShellEnv(stdout: string): ShellEnv | null {
  const lines = stdout.split(/\r?\n/)
  const startIndex = lines.indexOf(SHELL_ENV_START_MARKER)
  const endIndex = lines.indexOf(SHELL_ENV_END_MARKER)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null
  }

  const env: ShellEnv = {}
  for (const line of lines.slice(startIndex + 1, endIndex)) {
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    env[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1)
  }

  return Object.keys(env).length > 0 ? env : null
}

async function loadShellEnv(): Promise<ShellEnv> {
  if (process.platform === 'win32') {
    return {}
  }

  for (const shellPath of getCandidateShells()) {
    if (shellPath.startsWith('/') && !existsSync(shellPath)) {
      continue
    }

    try {
      const { stdout } = await execFileAsync(shellPath, getShellEnvArgs(shellPath), {
        cwd: os.homedir(),
        env: process.env,
        maxBuffer: MAX_PROVIDER_BUFFER,
        timeout: SHELL_ENV_TIMEOUT_MS,
      })
      const shellEnv = parseShellEnv(stdout)
      if (shellEnv) {
        return shellEnv
      }
    } catch {
      // Shell startup files can be noisy or interactive; fall back to the app environment.
    }
  }

  return {}
}

async function getProviderEnv(): Promise<NodeJS.ProcessEnv> {
  providerEnvPromise ??= loadShellEnv().then((shellEnv) => ({
    ...process.env,
    ...withCommonProviderPathDirs(shellEnv),
  }))

  return providerEnvPromise
}

function withCommonProviderPathDirs(env: ShellEnv): ShellEnv {
  const pathEntries = (env.PATH || process.env.PATH || '')
    .split(path.delimiter)
    .filter((entry) => entry.length > 0)
  const seen = new Set(pathEntries)

  for (const dir of COMMON_PROVIDER_PATH_DIRS) {
    if (!seen.has(dir) && existsSync(dir)) {
      pathEntries.push(dir)
      seen.add(dir)
    }
  }

  return {
    ...env,
    PATH: pathEntries.join(path.delimiter),
  }
}

export function warmAiTabMetadataProviderEnv(): void {
  void getProviderEnv()
}

function normalizeProviderError(error: unknown, fallback: string, commandName = 'AI provider'): Error {
  if (isExecError(error)) {
    if (error.code === 'ENOENT') {
      return new Error(`${commandName} is not installed or is not available on PATH.`)
    }

    if (error.killed || error.signal === 'SIGTERM') {
      return new Error(`${commandName} timed out before returning a result.`)
    }

    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : ''
    if (stderr.length > 0) {
      return new Error(stderr.split(/\r?\n/).slice(-1)[0] ?? fallback)
    }
  }

  return error instanceof Error ? error : new Error(fallback)
}

function normalizeGeneratedText(target: AiTabMetadataTarget, rawText: string): string {
  const withoutFences = rawText
    .replace(/^```(?:text|txt|markdown|md)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const withoutOuterQuotes = withoutFences.replace(/^["'](.+)["']$/s, '$1').trim()

  if (target === 'title') {
    return withoutOuterQuotes.replace(/\s+/g, ' ').slice(0, MAX_TITLE_CHARS).trim()
  }

  return withoutOuterQuotes
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .slice(0, MAX_NOTE_CHARS)
    .trim()
}

function buildPrompt(request: AiTabMetadataGenerateRequest): string {
  const context = request.context
  const recentOutput = context.recentOutput.slice(-MAX_CONTEXT_CHARS)
  const targetInstruction =
    request.target === 'title'
      ? 'Return a short terminal tab title, ideally 2 to 5 words. Prefer the active process, command, task, or problem shown in the terminal. Do not include the project name, current tab name, terminal number, punctuation wrappers, or generic words like "terminal".'
      : 'Return one direct sentence that explains what is going on in the terminal. Keep it short and practical. Prefer a few clear words over detail. Do not include the project name, current tab name, prefixes, labels, quotes, Markdown, or commentary.'

  return [
    'You are helping Terminay generate terminal tab metadata.',
    targetInstruction,
    'Do not include Markdown fences, labels, alternatives, or commentary. Return only the generated text.',
    '',
    `Project title: ${context.projectTitle}`,
    `Project root: ${context.projectRoot || '(none)'}`,
    `Current tab title: ${context.currentTitle}`,
    `Existing note: ${context.existingNote || '(none)'}`,
    '',
    'Recent terminal output:',
    recentOutput || '(no terminal output captured)',
  ].join('\n')
}

function runCodexExec(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(getCodexCommand(), args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let didSettle = false
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, options.timeout)

    child.stdin.end()

    const appendOutput = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString('utf8')
      return next.length > MAX_PROVIDER_BUFFER ? next.slice(-MAX_PROVIDER_BUFFER) : next
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk)
    })

    child.on('error', (error) => {
      if (didSettle) {
        return
      }

      didSettle = true
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code, signal) => {
      if (didSettle) {
        return
      }

      didSettle = true
      clearTimeout(timeout)

      if (code === 0) {
        resolve()
        return
      }

      const error = new Error(stderr.trim() || stdout.trim() || `Codex exited with code ${code ?? 'unknown'}.`) as Error & {
        killed?: boolean
        signal?: NodeJS.Signals | null
        stderr?: string
        stdout?: string
      }
      error.killed = signal === 'SIGTERM'
      error.signal = signal
      error.stderr = stderr
      error.stdout = stdout
      reject(error)
    })
  })
}

function buildClaudeCodeEnv(providerEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...providerEnv }
  const openRouterApiKey = env.OPENROUTER_API_KEY?.trim()

  if (env.TERMINAY_TEST_USE_REAL_CLAUDE_CODE === '1' && openRouterApiKey) {
    env.ANTHROPIC_AUTH_TOKEN = env.ANTHROPIC_AUTH_TOKEN?.trim() || openRouterApiKey
    env.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL?.trim() || 'https://openrouter.ai/api'
    env.ANTHROPIC_API_KEY = ''
  }

  return env
}

function extractClaudeCodeText(stdout: string): string {
  let text = ''

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        event?: { delta?: { text?: unknown; type?: unknown } }
        message?: { content?: Array<{ text?: unknown; type?: unknown }> }
        type?: unknown
      }

      const delta = parsed.event?.delta
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        text += delta.text
        continue
      }

      if (parsed.type === 'assistant' && Array.isArray(parsed.message?.content)) {
        const messageText = parsed.message.content
          .filter((block) => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text as string)
          .join('')

        if (messageText) {
          text = messageText
        }
      }
    } catch {
      // Ignore non-JSON output from Claude Code and rely on structured stream events.
    }
  }

  return text
}

function runClaudeCodePrint(
  prompt: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; model: string; timeout: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      getClaudeCodeCommand(),
      [
        '--print',
        '--verbose',
        '--model',
        options.model,
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--no-session-persistence',
        '--permission-mode',
        'dontAsk',
      ],
      {
        cwd: options.cwd,
        env: buildClaudeCodeEnv(options.env),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    let didSettle = false
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, options.timeout)

    child.stdin.end(prompt)

    const appendOutput = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString('utf8')
      return next.length > MAX_PROVIDER_BUFFER ? next.slice(-MAX_PROVIDER_BUFFER) : next
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk)
    })

    child.on('error', (error) => {
      if (didSettle) {
        return
      }

      didSettle = true
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code, signal) => {
      if (didSettle) {
        return
      }

      didSettle = true
      clearTimeout(timeout)

      if (code === 0) {
        resolve(extractClaudeCodeText(stdout))
        return
      }

      const error = new Error(stderr.trim() || stdout.trim() || `Claude Code exited with code ${code ?? 'unknown'}.`) as Error & {
        killed?: boolean
        signal?: NodeJS.Signals | null
        stderr?: string
        stdout?: string
      }
      error.killed = signal === 'SIGTERM'
      error.signal = signal
      error.stderr = stderr
      error.stdout = stdout
      reject(error)
    })
  })
}

export class AiTabMetadataService {
  private claudeCodeModels: AiTabMetadataModel[] | null = null
  private codexModels: AiTabMetadataModel[] | null = null
  private testMock: AiTabMetadataTestMock = {
    models: [{ id: 'codex-test-model', label: 'Codex Test Model' }],
    noteResult: 'Generated note from Codex',
    titleResult: 'Generated Title',
  }

  constructor(private readonly cwd: string) {}

  setTestMock(mock: AiTabMetadataTestMock): void {
    this.testMock = {
      ...this.testMock,
      ...mock,
      error: mock.error ?? null,
    }
    if (mock.models) {
      this.claudeCodeModels = mock.models
      this.codexModels = mock.models
    }
  }

  async listModels(provider: AiTabMetadataProvider): Promise<AiTabMetadataModel[]> {
    if (provider !== 'codex' && provider !== 'claudeCode') {
      throw new Error(`Unsupported AI provider: ${provider}`)
    }

    const isUsingMock =
      process.env.TERMINAY_TEST === '1' &&
      ((provider === 'codex' && process.env.TERMINAY_TEST_USE_REAL_CODEX !== '1') ||
        (provider === 'claudeCode' && process.env.TERMINAY_TEST_USE_REAL_CLAUDE_CODE !== '1'))

    if (isUsingMock) {
      return this.testMock.models ?? []
    }

    if (provider === 'claudeCode') {
      if (this.claudeCodeModels) {
        return this.claudeCodeModels
      }

      const models = getConfiguredClaudeCodeModels()
      this.claudeCodeModels = models
      return models
    }

    const configuredModels = getConfiguredCodexModels()
    if (configuredModels) {
      this.codexModels = configuredModels
      return configuredModels
    }

    if (this.codexModels) {
      return this.codexModels
    }

    try {
      const providerEnv = await getProviderEnv()
      const { stdout } = await execFileAsync(getCodexCommand(), ['debug', 'models'], {
        cwd: this.cwd,
        env: providerEnv,
        maxBuffer: MAX_PROVIDER_BUFFER,
        timeout: MODEL_LIST_TIMEOUT_MS,
      })
      const catalog = JSON.parse(stdout) as CodexCatalog
      const models = (catalog.models ?? [])
        .filter((model) => typeof model.slug === 'string' && model.slug.trim().length > 0)
        .filter((model) => !model.visibility || model.visibility === 'list')
        .sort((left, right) => (left.priority ?? 999) - (right.priority ?? 999))
        .map((model) => ({
          id: model.slug as string,
          label: model.display_name || (model.slug as string),
        }))

      if (models.length === 0) {
        throw new Error('Codex did not return any available models.')
      }

      this.codexModels = models
      return models
    } catch (error) {
      throw normalizeProviderError(error, 'Unable to list Codex models.', 'Codex')
    }
  }

  async generate(request: AiTabMetadataGenerateRequest): Promise<AiTabMetadataGenerateResult> {
    if (request.provider !== 'codex' && request.provider !== 'claudeCode') {
      throw new Error(`Unsupported AI provider: ${request.provider}`)
    }

    if (!request.model.trim()) {
      throw new Error('Choose an AI model before generating tab metadata.')
    }

    const isUsingMock =
      process.env.TERMINAY_TEST === '1' &&
      ((request.provider === 'codex' && process.env.TERMINAY_TEST_USE_REAL_CODEX !== '1') ||
        (request.provider === 'claudeCode' && process.env.TERMINAY_TEST_USE_REAL_CLAUDE_CODE !== '1'))

    if (isUsingMock) {
      if (this.testMock.error) {
        throw new Error(this.testMock.error)
      }

      return {
        text: request.target === 'title'
          ? (this.testMock.titleResult ?? 'Generated Title')
          : (this.testMock.noteResult ?? 'Generated note from Codex'),
      }
    }

    if (request.provider === 'claudeCode') {
      try {
        const providerEnv = await getProviderEnv()
        const rawText = await runClaudeCodePrint(buildPrompt(request), {
          cwd: this.cwd,
          env: providerEnv,
          model: request.model,
          timeout: PROVIDER_TIMEOUT_MS,
        })
        const text = normalizeGeneratedText(request.target, rawText)
        if (!text) {
          throw new Error('Claude Code returned an empty result.')
        }

        return { text }
      } catch (error) {
        throw normalizeProviderError(error, 'Unable to generate tab metadata with Claude Code.', 'Claude Code')
      }
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'terminay-codex-'))
    const outputPath = path.join(tempDir, 'last-message.txt')

    try {
      const providerEnv = await getProviderEnv()
      await runCodexExec(
        [
          'exec',
          '--model',
          request.model,
          '-c',
          'model_reasoning_effort="low"',
          '--sandbox',
          'read-only',
          '--skip-git-repo-check',
          '--ephemeral',
          '--ignore-rules',
          '--color',
          'never',
          '--cd',
          this.cwd,
          '-o',
          outputPath,
          buildPrompt(request),
        ],
        {
          cwd: this.cwd,
          env: providerEnv,
          timeout: PROVIDER_TIMEOUT_MS,
        },
      )

      const rawText = await readFile(outputPath, 'utf8')
      const text = normalizeGeneratedText(request.target, rawText)
      if (!text) {
        throw new Error('Codex returned an empty result.')
      }

      return { text }
    } catch (error) {
      throw normalizeProviderError(error, 'Unable to generate tab metadata with Codex.', 'Codex')
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  }
}
