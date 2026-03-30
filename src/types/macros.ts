export type MacroSubmitMode = 'type-only' | 'type-and-submit'

export type MacroFieldType = 'text' | 'textarea' | 'select' | 'number' | 'checkbox' | 'emoji'

export type MacroFieldOption = {
  label: string
  value: string
}

export type MacroFieldValue = string | number | boolean

export type MacroFieldDefinition = {
  id: string
  name: string
  label: string
  type: MacroFieldType
  required: boolean
  description: string
  placeholder: string
  defaultValue: MacroFieldValue
  options: MacroFieldOption[]
}

export type MacroDefinition = {
  id: string
  title: string
  description: string
  template: string
  submitMode: MacroSubmitMode
  fields: MacroFieldDefinition[]
}
