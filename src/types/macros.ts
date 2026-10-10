export type MacroFieldType = 'text' | 'textarea' | 'select' | 'number' | 'checkbox' | 'emoji' | 'file'

export type MacroFieldOption = {
  label: string
  value: string
}

export type MacroFieldValue = string | number | boolean

export type MacroFieldDefinition = {
  id: string
  name: string
  label: string
  optionsText?: string
  type: MacroFieldType
  required: boolean
  description: string
  placeholder: string
  defaultValue: MacroFieldValue
  options: MacroFieldOption[]
}

export type MacroStepType =
  | 'type'              // Types a string (supports {{Field}} variables)
  | 'key'               // Presses a specific key
  | 'wait_time'         // Pauses execution for X seconds
  | 'wait_inactivity'   // Pauses execution until terminal stops outputting data for X seconds
  | 'select_line'       // Sends an ANSI sequence to select the current line
  | 'paste'             // Pastes current clipboard contents
  | 'unsupported'       // A stored step Terminay does not execute; the macro cannot run while it holds one

export type MacroStep =
  | { id: string; type: 'type'; content: string }
  | { id: string; type: 'key'; key: string }
  | { id: string; type: 'wait_time'; durationSeconds: string }
  | { id: string; type: 'wait_inactivity'; durationSeconds: string }
  | { id: string; type: 'select_line' }
  | { id: string; type: 'paste' }
  | { id: string; type: 'unsupported'; sourceType: string }

export type MacroDefinition = {
  /** Name of the category the macro belongs to, or empty for none. */
  category: string
  description: string
  fields: MacroFieldDefinition[]
  id: string
  steps: MacroStep[]
  submitMode: 'type-only' | 'type-and-submit'
  template: string
  title: string
}
