import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  AiTabMetadataGenerateRequest,
  AiTabMetadataGenerateResult,
  AiTabMetadataModel,
  AiTabMetadataProvider,
  AiTabMetadataTarget,
} from '../../src/types/termide'

const execFileAsync = promisify(execFile)
const CODEX_TIMEOUT_MS = 90_000
const MODEL_LIST_TIMEOUT_MS = 15_000
const MAX_CODEX_BUFFER = 1024 * 1024 * 6
const MAX_CONTEXT_CHARS = 20_000
const MAX_TITLE_CHARS = 64
const MAX_NOTE_CHARS = 1200

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

function getCodexCommand(): string {
  return process.env.TERMIDE_CODEX_COMMAND?.trim() || 'codex'
}

function getConfiguredCodexModels(): AiTabMetadataModel[] | null {
  const modelsJson = process.env.TERMIDE_CODEX_MODELS_JSON?.trim()
  if (modelsJson) {
    let parsed: unknown
    try {
      parsed = JSON.parse(modelsJson) as unknown
    } catch {
      throw new Error('TERMIDE_CODEX_MODELS_JSON must contain valid JSON.')
    }

    if (!Array.isArray(parsed)) {
      throw new Error('TERMIDE_CODEX_MODELS_JSON must be a JSON array.')
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
      throw new Error('TERMIDE_CODEX_MODELS_JSON did not contain any usable models.')
    }

    return models
  }

  const model = process.env.TERMIDE_CODEX_TEST_MODEL?.trim()
  if (model) {
    return [{ id: model, label: model }]
  }

  return null
}

function isExecError(error: unknown): error is NodeJS.ErrnoException & {
  killed?: boolean
  signal?: NodeJS.Signals
  stderr?: string
  stdout?: string
} {
  return typeof error === 'object' && error !== null
}

function normalizeProviderError(error: unknown, fallback: string): Error {
  if (isExecError(error)) {
    if (error.code === 'ENOENT') {
      return new Error('Codex is not installed or is not available on PATH.')
    }

    if (error.killed || error.signal === 'SIGTERM') {
      return new Error('Codex timed out before returning a result.')
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
    'You are helping Termide generate terminal tab metadata.',
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

function runCodexExec(args: string[], options: { cwd: string; timeout: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(getCodexCommand(), args, {
      cwd: options.cwd,
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
      return next.length > MAX_CODEX_BUFFER ? next.slice(-MAX_CODEX_BUFFER) : next
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

export class AiTabMetadataService {
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
      this.codexModels = mock.models
    }
  }

  async listModels(provider: AiTabMetadataProvider): Promise<AiTabMetadataModel[]> {
    if (provider !== 'codex') {
      throw new Error(`Unsupported AI provider: ${provider}`)
    }

    if (process.env.TERMIDE_TEST === '1' && process.env.TERMIDE_TEST_USE_REAL_CODEX !== '1') {
      return this.testMock.models ?? []
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
      const { stdout } = await execFileAsync(getCodexCommand(), ['debug', 'models'], {
        cwd: this.cwd,
        maxBuffer: MAX_CODEX_BUFFER,
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
      throw normalizeProviderError(error, 'Unable to list Codex models.')
    }
  }

  async generate(request: AiTabMetadataGenerateRequest): Promise<AiTabMetadataGenerateResult> {
    if (request.provider !== 'codex') {
      throw new Error(`Unsupported AI provider: ${request.provider}`)
    }

    if (!request.model.trim()) {
      throw new Error('Choose a Codex model before generating tab metadata.')
    }

    if (process.env.TERMIDE_TEST === '1' && process.env.TERMIDE_TEST_USE_REAL_CODEX !== '1') {
      if (this.testMock.error) {
        throw new Error(this.testMock.error)
      }

      return {
        text: request.target === 'title'
          ? (this.testMock.titleResult ?? 'Generated Title')
          : (this.testMock.noteResult ?? 'Generated note from Codex'),
      }
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'termide-codex-'))
    const outputPath = path.join(tempDir, 'last-message.txt')

    try {
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
          timeout: CODEX_TIMEOUT_MS,
        },
      )

      const rawText = await readFile(outputPath, 'utf8')
      const text = normalizeGeneratedText(request.target, rawText)
      if (!text) {
        throw new Error('Codex returned an empty result.')
      }

      return { text }
    } catch (error) {
      throw normalizeProviderError(error, 'Unable to generate tab metadata with Codex.')
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  }
}
