import type {
  MacroDefinition,
  MacroFieldDefinition,
  MacroFieldOption,
  MacroFieldType,
  MacroFieldValue,
  MacroSubmitMode,
} from './types/macros'

const placeholderPattern = /{{\s*([^{}]+?)\s*}}/g

export const defaultMacros: MacroDefinition[] = [
  {
    id: 'create-pull-request',
    title: 'Create a pull request',
    description: 'Ask the agent to branch, commit, push, and open a pull request with gh.',
    template:
      'Create a branch and commit all the unstaged changes into that branch, then push up and create a pull request using the gh cli tool.',
    submitMode: 'type-only',
    fields: [],
  },
  {
    id: 'say-hello',
    title: 'Say hello to person',
    description: 'Example macro showing how placeholders become form inputs.',
    template: 'Say hello to {{Name of person}} with a {{Emoji}} emoji',
    submitMode: 'type-only',
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

function normalizeSubmitMode(value: unknown): MacroSubmitMode {
  return value === 'type-and-submit' ? 'type-and-submit' : 'type-only'
}

function normalizeFieldType(value: unknown): MacroFieldType {
  switch (value) {
    case 'textarea':
    case 'select':
    case 'number':
    case 'checkbox':
    case 'emoji':
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

export function extractTemplatePlaceholders(template: string): string[] {
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

export function inferFieldsFromTemplate(template: string): MacroFieldDefinition[] {
  return extractTemplatePlaceholders(template).map((placeholder, index) => ({
    id: `macro-field-${index + 1}`,
    name: placeholder,
    label: placeholder,
    type: 'text',
    required: true,
    description: '',
    placeholder: '',
    defaultValue: '',
    options: [],
  }))
}

export function mergeFieldsWithTemplate(template: string, fields: MacroFieldDefinition[]): MacroFieldDefinition[] {
  const placeholders = extractTemplatePlaceholders(template)
  const placeholderSet = new Set(placeholders)

  // Keep existing fields that are still in the template, in their current order
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

export function mergeMacroFieldsWithTemplate(macro: MacroDefinition): MacroFieldDefinition[] {
  const explicitFields = new Map(macro.fields.map((field) => [field.name.trim().toLowerCase(), field]))

  return extractTemplatePlaceholders(macro.template).map((placeholder, index) => {
    const existing = explicitFields.get(placeholder.toLowerCase())
    if (existing) {
      return existing
    }

    return {
      id: `macro-field-${index + 1}`,
      name: placeholder,
      label: placeholder,
      type: 'text',
      required: true,
      description: '',
      placeholder: '',
      defaultValue: '',
      options: [],
    }
  })
}

export function getMacroSubmitSuffix(submitMode: MacroSubmitMode): string {
  return submitMode === 'type-and-submit' ? '\r' : ''
}

export function normalizeMacro(input: unknown, index: number): MacroDefinition {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const template = normalizeString(record.template)
  const explicitFields = Array.isArray(record.fields) ? record.fields.map(normalizeField) : []

  return {
    id: normalizeString(record.id).trim() || `macro-${index + 1}`,
    title: normalizeString(record.title).trim() || `Macro ${index + 1}`,
    description: normalizeString(record.description),
    template,
    submitMode: normalizeSubmitMode(record.submitMode),
    fields: mergeFieldsWithTemplate(template, explicitFields),
  }
}

export function normalizeMacros(input: unknown): MacroDefinition[] {
  if (!Array.isArray(input)) {
    return defaultMacros
  }

  return input.map(normalizeMacro)
}
