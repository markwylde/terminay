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
      { id: 'step-3', type: 'wait_inactivity', durationMs: 3000 },
      { id: 'step-4', type: 'type', content: 'sudo apt-get upgrade -y' },
      { id: 'step-5', type: 'key', key: 'Enter' },
    ],
    fields: [],
  },
  {
    id: 'create-pull-request',
    title: 'Create a pull request',
    description: 'Ask the agent to branch, commit, push, and open a pull request with gh.',
    template:
      'Create a branch and commit all the unstaged changes into that branch, then push up and create a pull request using the gh cli tool.',
    submitMode: 'type-only',
    steps: [
      {
        id: 'step-1',
        type: 'type',
        content: 'Create a branch and commit all the unstaged changes into that branch, then push up and create a pull request using the gh cli tool.',
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
      return { id, type, durationMs: normalizeNumber(record.durationMs, 1000) }
    case 'wait_inactivity':
      return { id, type, durationMs: normalizeNumber(record.durationMs, 3000) }
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

export function extractAllMacroPlaceholders(macro: MacroDefinition): string[] {
  const seen = new Set<string>()
  const placeholders: string[] = []

  for (const step of macro.steps) {
    if (step.type === 'type') {
      const stepPlaceholders = extractTemplatePlaceholders(step.content)
      for (const p of stepPlaceholders) {
        if (!seen.has(p)) {
          seen.add(p)
          placeholders.push(p)
        }
      }
    }
  }

  return placeholders
}

export function renderMacroTemplate(template: string, values: Record<string, MacroFieldValue>): string {
  return template.replace(placeholderPattern, (_match, token: string) => {
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

export function mergeFieldsWithSteps(steps: MacroStep[], fields: MacroFieldDefinition[]): MacroFieldDefinition[] {
  const placeholders: string[] = []
  const seen = new Set<string>()

  for (const step of steps) {
    if (step.type === 'type') {
      const stepPlaceholders = extractTemplatePlaceholders(step.content)
      for (const p of stepPlaceholders) {
        if (!seen.has(p)) {
          seen.add(p)
          placeholders.push(p)
        }
      }
    }
  }

  const placeholderSet = new Set(placeholders)

  // Keep existing fields that are still in any step, in their current order
  const existingValidFields = fields.filter((f) => placeholderSet.has(f.name))
  const existingNames = new Set(existingValidFields.map((f) => f.name))

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

  return [...existingValidFields, ...missingFields]
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
            return `[wait:${step.durationMs}]`
          case 'wait_inactivity':
            return `[wait-inactive:${step.durationMs}]`
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
