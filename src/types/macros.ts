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
  | 'secret'            // Pastes a stored secret
  | 'wait_time'         // Pauses execution for X milliseconds
  | 'wait_inactivity'   // Pauses execution until terminal stops outputting data for X ms
  | 'select_line'       // Sends an ANSI sequence to select the current line
  | 'paste'             // Pastes current clipboard contents

export type MacroStep =
  | { id: string; type: 'type'; content: string }
  | { id: string; type: 'key'; key: string }
  | { id: string; type: 'secret'; secretId: string }
  | { id: string; type: 'wait_time'; durationMs: number }
  | { id: string; type: 'wait_inactivity'; durationMs: number }
  | { id: string; type: 'select_line' }
  | { id: string; type: 'paste' }

export type MacroDefinition = {
  description: string
  fields: MacroFieldDefinition[]
  id: string
  steps: MacroStep[]
  submitMode: 'type-only' | 'type-and-submit'
  template: string
  title: string
}

export type SecretDefinition = {
  id: string
  name: string
}
