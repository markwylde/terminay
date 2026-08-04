import type {
  MacroDefinition,
  MacroFieldDefinition,
  MacroFieldOption,
  MacroFieldType,
  MacroFieldValue,
  MacroStep,
  MacroStepType,
} from './types/macros'

const placeholderPattern = /{{\s*([^{}]+?)\s*}}/g
const singleBracePlaceholderPattern = /{\s*([^{}]+?)\s*}/g
const etaTagPattern = /<%[-_]?\s*([~=]?)([\s\S]*?)\s*[-_]?%>/g
const identifierPattern = /^[A-Za-z_$][\w$]*$/u

export const defaultMacros: MacroDefinition[] = [
  {
    id: 'update-os',
    title: 'Update OS',
    description: 'Example of a multi-step macro that updates the system.',
    template: 'sudo apt-get update\nsudo apt-get upgrade -y',
    submitMode: 'type-and-submit',
    steps: [
      { id: 'step-1', type: 'type', content: 'sudo apt-get update' },
      { id: 'step-2', type: 'key', key: 'Enter' },
      { id: 'step-3', type: 'wait_inactivity', durationSeconds: '3' },
      { id: 'step-4', type: 'type', content: 'sudo apt-get upgrade -y' },
      { id: 'step-5', type: 'key', key: 'Enter' },
    ],
    fields: [],
  },
  {
    id: 'create-pull-request',
    title: 'Create a pull request',
    description: 'Ask the agent to branch, commit, push, and open a pull request.',
    template:
      'Create a branch and commit all the unstaged changes into that branch, then push it and create a pull request. Use gh for GitHub remotes, tea for Gitea remotes, or provide the remote URL if neither CLI applies.',
    submitMode: 'type-only',
    steps: [
      {
        id: 'step-1',
        type: 'type',
        content: 'Create a branch and commit all the unstaged changes into that branch, then push it and create a pull request. Use gh for GitHub remotes, tea for Gitea remotes, or provide the remote URL if neither CLI applies.',
      },
    ],
    fields: [],
  },
  {
    id: 'say-hello',
    title: 'Say hello to person',
    description: 'Example macro showing how placeholders become form inputs.',
    template: 'Say hello to {{Name of person}} with a {{Emoji}} emoji',
    submitMode: 'type-only',
    steps: [
      { id: 'step-1', type: 'type', content: 'Say hello to {{Name of person}} with a {{Emoji}} emoji' },
    ],
    fields: [
      {
        id: 'macro-field-1',
        name: 'Name of person',
        label: 'Name of person',
        type: 'text',
        required: true,
        description: '',
        placeholder: 'Ada Lovelace',
        defaultValue: '',
        options: [],
      },
      {
        id: 'macro-field-2',
        name: 'Emoji',
        label: 'Emoji',
        type: 'emoji',
        required: true,
        description: '',
        placeholder: '👋',
        defaultValue: '👋',
        options: [],
      },
    ],
  },
]

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeNumber(value: unknown, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

function normalizeDurationSeconds(record: Record<string, unknown>, fallbackSeconds: string): string {
  if (typeof record.durationSeconds === 'string') {
    return record.durationSeconds
  }

  if (typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)) {
    return formatSeconds(record.durationSeconds)
  }

  if (typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)) {
    return formatSeconds(record.durationMs / 1000)
  }

  if (typeof record.durationMs === 'string') {
    const parsedDurationMs = Number(record.durationMs)
    return Number.isFinite(parsedDurationMs) ? formatSeconds(parsedDurationMs / 1000) : record.durationMs
  }

  return fallbackSeconds
}

function normalizeFieldType(value: unknown): MacroFieldType {
  switch (value) {
    case 'textarea':
    case 'select':
    case 'number':
    case 'checkbox':
    case 'emoji':
    case 'file':
      return value
    default:
      return 'text'
  }
}

function normalizeFieldValue(value: unknown, type: MacroFieldType): MacroFieldValue {
  switch (type) {
    case 'number':
      return normalizeNumber(value, 0)
    case 'checkbox':
      return normalizeBoolean(value, false)
    default:
      return normalizeString(value)
  }
}

function normalizeFieldOptions(value: unknown): MacroFieldOption[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((option, index) => {
    if (typeof option !== 'object' || option === null) {
      return []
    }

    const record = option as Record<string, unknown>
    const label = normalizeString(record.label).trim()
    const rawValue = normalizeString(record.value).trim()
    const normalizedValue = rawValue || label || `option-${index + 1}`

    return [
      {
        label: label || normalizedValue,
        value: normalizedValue,
      },
    ]
  })
}

function normalizeFieldName(value: unknown, fallback: string): string {
  const normalized = normalizeString(value)
    .trim()
    .replace(/\s+/g, ' ')

  return normalized.length > 0 ? normalized : fallback
}

function normalizeField(input: unknown, index: number): MacroFieldDefinition {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const type = normalizeFieldType(record.type)
  const fallbackName = `field_${index + 1}`
  const name = normalizeFieldName(record.name, fallbackName)
  const label = normalizeString(record.label).trim() || name

  return {
    id: normalizeString(record.id).trim() || `macro-field-${index + 1}`,
    name,
    label,
    type,
    required: normalizeBoolean(record.required, true),
    description: normalizeString(record.description),
    placeholder: normalizeString(record.placeholder),
    defaultValue: normalizeFieldValue(record.defaultValue, type),
    options: normalizeFieldOptions(record.options),
  }
}

function normalizeStepType(value: unknown): MacroStepType {
  switch (value) {
    case 'key':
    case 'secret':
    case 'wait_time':
    case 'wait_inactivity':
    case 'select_line':
    case 'paste':
      return value
    default:
      return 'type'
  }
}

function normalizeStep(input: unknown, index: number): MacroStep {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const type = normalizeStepType(record.type)
  const id = normalizeString(record.id).trim() || `step-${index + 1}`

  switch (type) {
    case 'type':
      return { id, type, content: normalizeString(record.content) }
    case 'key':
      return { id, type, key: normalizeString(record.key, 'Enter') }
    case 'secret':
      return { id, type, secretId: normalizeString(record.secretId) }
    case 'wait_time':
      return { id, type, durationSeconds: normalizeDurationSeconds(record, '1') }
    case 'wait_inactivity':
      return { id, type, durationSeconds: normalizeDurationSeconds(record, '3') }
    case 'select_line':
    case 'paste':
      return { id, type }
  }
}

function extractTemplatePlaceholders(template: string): string[] {
  const matches = template.matchAll(placeholderPattern)
  const seen = new Set<string>()
  const placeholders: string[] = []

  for (const match of matches) {
    const placeholder = match[1]?.trim()
    if (!placeholder || seen.has(placeholder)) {
      continue
    }

    seen.add(placeholder)
    placeholders.push(placeholder)
  }

  return placeholders
}

function extractSingleBracePlaceholders(template: string): string[] {
  const seen = new Set<string>()
  const placeholders: string[] = []

  for (const match of template.matchAll(singleBracePlaceholderPattern)) {
    if (!isSingleBracePlaceholderMatch(template, match[0], match.index ?? 0)) {
      continue
    }

    const placeholder = match[1]?.trim()
    if (!placeholder || seen.has(placeholder)) {
      continue
    }

    seen.add(placeholder)
    placeholders.push(placeholder)
  }

  return placeholders
}

function isSingleBracePlaceholderMatch(template: string, match: string, index: number): boolean {
  return template[index - 1] !== '{' && template[index + match.length] !== '}'
}

function stripJavaScriptLiterals(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/`(?:\\[\s\S]|\$\{[\s\S]*?\}|[^\\`])*`/g, ' ')
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, ' ')
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, ' ')
}

function extractEtaPlaceholders(template: string): string[] {
  const seen = new Set<string>()
  const placeholders: string[] = []

  for (const match of template.matchAll(etaTagPattern)) {
    const marker = match[1] ?? ''
    const source = stripJavaScriptLiterals(match[2] ?? '')
    const names = marker === '=' || marker === '~'
      ? [source.trim().replace(/^it\./u, '')]
      : [source.match(/^if\s*\(\s*(?:it\.)?([A-Za-z_$][\w$]*)\s*(?:===|!==|==|!=)/u)?.[1] ?? '']
    for (const name of names) {
      if (identifierPattern.test(name) && !seen.has(name)) {
        seen.add(name)
        placeholders.push(name)
      }
    }
  }

  return placeholders
}

function extractMacroPlaceholders(template: string): string[] {
  const seen = new Set<string>()
  const placeholders: string[] = []

  for (const placeholder of [...extractTemplatePlaceholders(template), ...extractEtaPlaceholders(template)]) {
    if (!seen.has(placeholder)) {
      seen.add(placeholder)
      placeholders.push(placeholder)
    }
  }

  return placeholders
}

function extractDurationPlaceholders(template: string): string[] {
  const seen = new Set<string>()
  const placeholders: string[] = []

  for (const placeholder of [...extractMacroPlaceholders(template), ...extractSingleBracePlaceholders(template)]) {
    if (!seen.has(placeholder)) {
      seen.add(placeholder)
      placeholders.push(placeholder)
    }
  }

  return placeholders
}

function extractStepPlaceholders(step: MacroStep): string[] {
  switch (step.type) {
    case 'type':
      return extractMacroPlaceholders(step.content)
    case 'wait_time':
    case 'wait_inactivity':
      return extractDurationPlaceholders(step.durationSeconds)
    default:
      return []
  }
}

export function extractAllMacroPlaceholders(macro: MacroDefinition): string[] {
  const seen = new Set<string>()
  const placeholders: string[] = []

  for (const step of macro.steps) {
    const stepPlaceholders = extractStepPlaceholders(step)
    for (const p of stepPlaceholders) {
      if (!seen.has(p)) {
        seen.add(p)
        placeholders.push(p)
      }
    }
  }

  return placeholders
}

export function renderMacroTemplate(template: string, values: Record<string, MacroFieldValue>): string {
  const rendered = renderSafeEtaTemplate(template, values)

  return rendered.replace(placeholderPattern, (_match, token: string) => {
    const key = token.trim()
    const value = values[key]

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false'
    }

    if (typeof value === 'number') {
      return String(value)
    }

    return typeof value === 'string' ? value : ''
  })
}

/**
 * Render only the data-only Eta subset shared with server-core. Macro
 * definitions are server-owned input, so a preview must never evaluate
 * arbitrary JavaScript in the renderer. Unsupported tags fail closed and are
 * presented by tryRenderMacroTemplate as a safe preview error.
 */
function renderSafeEtaTemplate(template: string, values: Record<string, MacroFieldValue>): string {
  const stack: Array<{ parentActive: boolean; condition: boolean }> = []
  let active = true
  let cursor = 0
  let output = ''

  for (const match of template.matchAll(etaTagPattern)) {
    const index = match.index ?? 0
    if (active) {
      output += template.slice(cursor, index)
    }

    const marker = match[1] ?? ''
    const code = (match[2] ?? '').trim()
    if (marker === '=' || marker === '~') {
      if (active) {
        output += renderSafeEtaExpression(code, values)
      }
    } else if (/^if\s*\(/u.test(code)) {
      const condition = evaluateSafeEtaCondition(code, values)
      stack.push({ parentActive: active, condition })
      active = active && condition
    } else if (/^(?:\}\s*)?else\s*\{/u.test(code)) {
      const branch = stack.at(-1)
      if (!branch) {
        throw new Error('template has an unmatched else branch')
      }
      active = branch.parentActive && !branch.condition
    } else if (/^\}\s*$/u.test(code)) {
      const branch = stack.pop()
      if (!branch) {
        throw new Error('template has an unmatched closing branch')
      }
      active = branch.parentActive
    } else if (code.length > 0) {
      throw new Error('template expression is not allowed in the client preview')
    }
    cursor = index + match[0].length
  }

  if (active) {
    output += template.slice(cursor)
  }
  if (stack.length > 0) {
    throw new Error('template has an unterminated branch')
  }
  return output
}

function renderSafeEtaExpression(expression: string, values: Record<string, MacroFieldValue>): string {
  const name = safeEtaName(expression)
  if (!name) {
    throw new Error('template interpolation is not allowed in the client preview')
  }
  const value = values[name]
  return value === undefined ? '' : typeof value === 'string' ? value : String(value)
}

function evaluateSafeEtaCondition(code: string, values: Record<string, MacroFieldValue>): boolean {
  const match = /^if\s*\(\s*([A-Za-z_$][\w$]*|it\.[A-Za-z_$][\w$]*)\s*(===|!==|==|!=)\s*(true|false|null|-?\d+(?:\.\d+)?|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")\s*\)\s*\{?$/u.exec(code)
  if (!match) {
    throw new Error('template condition is not allowed in the client preview')
  }
  const name = safeEtaName(match[1] ?? '')
  if (!name) {
    throw new Error('template condition field is invalid')
  }
  const actual = values[name]
  const expectedToken = match[3] ?? ''
  const expected: MacroFieldValue | null = expectedToken === 'true'
    ? true
    : expectedToken === 'false'
      ? false
      : expectedToken === 'null'
        ? null
        : (expectedToken.startsWith("'") || expectedToken.startsWith('"'))
          ? expectedToken.slice(1, -1).replace(/\\(['"])/g, '$1')
          : Number(expectedToken)
  const equal = actual === expected
  return match[2] === '!==' || match[2] === '!=' ? !equal : equal
}

function safeEtaName(expression: string): string | undefined {
  const normalized = expression.trim().replace(/^it\./u, '')
  return identifierPattern.test(normalized) ? normalized : undefined
}

function renderSingleBraceMacroTemplate(template: string, values: Record<string, MacroFieldValue>): string {
  return template.replace(singleBracePlaceholderPattern, (match: string, token: string, index: number) => {
    if (!isSingleBracePlaceholderMatch(template, match, index)) {
      return match
    }

    const key = token.trim()
    const value = values[key]

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false'
    }

    if (typeof value === 'number') {
      return `${value}`
    }

    return typeof value === 'string' ? value : ''
  })
}

export function renderMacroDurationMs(
  durationSeconds: string,
  values: Record<string, MacroFieldValue>,
): number {
  const renderedSeconds = renderSingleBraceMacroTemplate(renderMacroTemplate(durationSeconds, values), values).trim()
  const seconds = Number(renderedSeconds)

  if (!renderedSeconds || !Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Wait duration "${renderedSeconds || durationSeconds}" must resolve to a non-negative number of seconds.`)
  }

  return Math.round(seconds * 1000)
}

export function tryRenderMacroTemplate(template: string, values: Record<string, MacroFieldValue>): string {
  try {
    return renderMacroTemplate(template, values)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Template error: ${message}`
  }
}

export function mergeFieldsWithSteps(steps: MacroStep[], fields: MacroFieldDefinition[]): MacroFieldDefinition[] {
  const placeholders: string[] = []
  const seen = new Set<string>()

  for (const step of steps) {
    const stepPlaceholders = extractStepPlaceholders(step)
    for (const p of stepPlaceholders) {
      if (!seen.has(p)) {
        seen.add(p)
        placeholders.push(p)
      }
    }
  }

  const existingNames = new Set(fields.map((f) => f.name))

  // Add missing placeholders
  const missingFields = placeholders
    .filter((p) => !existingNames.has(p))
    .map((placeholder, index) => ({
      id: `macro-field-${Date.now()}-${index}`,
      name: placeholder,
      label: placeholder,
      type: 'text' as const,
      required: true,
      description: '',
      placeholder: '',
      defaultValue: '',
      options: [],
    }))

  return [...fields, ...missingFields]
}

function deriveLegacyTemplate(steps: MacroStep[]): Pick<MacroDefinition, 'submitMode' | 'template'> {
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : undefined
  const submitMode: MacroDefinition['submitMode'] =
    lastStep?.type === 'key' && lastStep.key === 'Enter' ? 'type-and-submit' : 'type-only'

  const templateSteps = submitMode === 'type-and-submit' ? steps.slice(0, -1) : steps

  return {
    submitMode,
    template: templateSteps
      .map((step) => {
        switch (step.type) {
          case 'type':
            return step.content
          case 'key':
            return `[key:${step.key}]`
          case 'secret':
            return `[secret:${step.secretId}]`
          case 'wait_time':
            return `[wait:${step.durationSeconds}s]`
          case 'wait_inactivity':
            return `[wait-inactive:${step.durationSeconds}s]`
          case 'select_line':
            return '[select-line]'
          case 'paste':
            return '[paste]'
          default:
            return ''
        }
      })
      .join('\n'),
  }
}

function normalizeMacro(input: unknown, index: number): MacroDefinition {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const explicitFields = Array.isArray(record.fields) ? record.fields.map(normalizeField) : []

  let steps: MacroStep[] = []
  if (Array.isArray(record.steps)) {
    steps = record.steps.map(normalizeStep)
  } else if (typeof record.template === 'string') {
    // Legacy migration
    steps.push({
      id: 'step-1',
      type: 'type',
      content: record.template,
    })
    const submitMode = (record as Record<string, unknown>).submitMode
    if (submitMode === 'type-and-submit') {
      steps.push({
        id: 'step-2',
        type: 'key',
        key: 'Enter',
      })
    }
  }

  return {
    id: normalizeString(record.id).trim() || `macro-${index + 1}`,
    title: normalizeString(record.title).trim() || `Macro ${index + 1}`,
    description: normalizeString(record.description),
    ...deriveLegacyTemplate(steps),
    steps,
    fields: mergeFieldsWithSteps(steps, explicitFields),
  }
}

export function normalizeMacros(input: unknown): MacroDefinition[] {
  if (!Array.isArray(input)) {
    return defaultMacros
  }

  return input.map(normalizeMacro)
}
