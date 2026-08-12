export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ExtensionPermission =
  | "configuration:read"
  | "configuration:write"
  | "data:read"
  | "data:write"
  | "cache:write"
  | "network"
  | "secrets:resolve"
  | "provider:depend"
  | "external-resources:manage";

export type EnvironmentCapability =
  | "terminal"
  | "filesystem"
  | "filesystem-watch"
  | "git"
  | "process-observation"
  | "agent-journal"
  | "mcp";

export interface ExtensionDependency {
  extensionId: string;
  apiRange: string;
  optional?: boolean;
}

export interface ProjectEnvironmentContribution {
  id: string;
  displayName: string;
  description?: string;
  icon?: ExtensionIcon;
  capabilities: EnvironmentCapability[];
}

export interface TerminayExtensionManifest {
  manifestVersion: 1;
  id: string;
  displayName: string;
  description?: string;
  api: string;
  engines: {
    terminay: string;
    node: string;
  };
  entrypoint: string;
  platforms?: Array<"darwin" | "linux" | "win32">;
  permissions: ExtensionPermission[];
  extensionDependencies?: ExtensionDependency[];
  contributes: {
    projectEnvironments: ProjectEnvironmentContribution[];
  };
}

export type ExtensionIcon =
  | "terminal"
  | "server"
  | "cloud"
  | "key"
  | "folder"
  | "network"
  | "database"
  | "warning"
  | "info";

export interface VisibilityCondition {
  fieldId: string;
  equals?: JsonPrimitive;
  notEquals?: JsonPrimitive;
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabledReason?: string;
}

interface BaseField {
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  disabledReason?: string;
  visibleWhen?: VisibilityCondition;
}

export interface TextField extends BaseField {
  type: "text" | "url" | "secret" | "textarea";
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface NumberField extends BaseField {
  type: "number";
  minimum?: number;
  maximum?: number;
  step?: number;
}

export interface BooleanField extends BaseField {
  type: "checkbox" | "switch";
}

export interface SelectField extends BaseField {
  type: "select";
  options?: SelectOption[];
  optionSource?: string;
  searchable?: boolean;
  multiple?: boolean;
}

export interface PresetCardsField extends BaseField {
  type: "preset-cards";
  options: Array<SelectOption & { icon?: ExtensionIcon }>;
}

export type FormField = TextField | NumberField | BooleanField | SelectField | PresetCardsField;

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  disclosure?: "always" | "expanded" | "collapsed";
  fields: FormField[];
}

export interface DeclarativeForm {
  id: string;
  title: string;
  description?: string;
  sections: FormSection[];
  submitLabel: string;
}

export interface ValidationIssue {
  fieldId?: string;
  code: string;
  message: string;
}

export interface ProgressStage {
  id: string;
  label: string;
  state: "pending" | "active" | "complete" | "failed";
  detail?: string;
}

export interface ProgressPresentation {
  operationId: string;
  title: string;
  stages: ProgressStage[];
  resumable: boolean;
}

export interface ConfirmationPresentation {
  title: string;
  message: string;
  kind: "ordinary" | "destructive";
  confirmLabel: string;
  expectedRevision: number;
}

export interface PresentationAction {
  id: string;
  label: string;
  kind?: "primary" | "secondary" | "destructive";
  disabledReason?: string;
  confirmation?: ConfirmationPresentation;
}

export interface StatusCard {
  id: string;
  title: string;
  summary: string;
  icon?: ExtensionIcon;
  tone?: "neutral" | "positive" | "warning" | "danger";
  facts?: Array<{ label: string; value: string }>;
  actions?: PresentationAction[];
  httpsLink?: { label: string; url: string };
}

export interface ProviderDefinition {
  providerId: string;
  displayName: string;
  description?: string;
  icon?: ExtensionIcon;
  capabilities: EnvironmentCapability[];
  profileForm?: DeclarativeForm;
  createForm?: DeclarativeForm;
}

export interface CancellationSignal {
  readonly aborted: boolean;
  throwIfAborted(): void;
}

export interface ExtensionContext {
  extensionId: string;
  apiVersion: string;
  paths: { configuration: string; data: string; cache: string };
  registerProjectEnvironmentProvider(definition: ProviderDefinition): void;
}

export interface TerminayExtension {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export function defineExtension(extension: TerminayExtension): TerminayExtension {
  return extension;
}
