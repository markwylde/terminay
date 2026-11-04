import type { JsonValue } from "@terminay/protocol";
import type { QueryCommandTransport } from "./queryCommand.js";
import type { CommandOptions, QueryOptions } from "./types.js";

/** Feature capability a server advertises when it serves workflows (ADR-0097). */
export const WORKFLOWS_CAPABILITY = "workflows.v1" as const;

export const WORKFLOW_OPERATIONS = Object.freeze({
  templatesGet: "workflows.templates.get",
  templatesUpsert: "workflows.templates.upsert",
  templatesRemove: "workflows.templates.remove",
  templatesReorder: "workflows.templates.reorder",
  templatesReplace: "workflows.templates.replace",
  list: "workflows.list",
  get: "workflows.get",
  launch: "workflow.launch",
  resume: "workflow.resume",
  remove: "workflow.remove",
} as const);

export const WORKFLOW_EVENTS = Object.freeze({
  templatesChanged: "workflows.templates.changed",
  changed: "workflows.changed",
} as const);

/** The icons a step may show; any other name shows none. */
export const WORKFLOW_ICON_NAMES = Object.freeze([
  "lightbulb", "eye", "wrench", "code", "flask", "archive",
  "pull-request", "terminal", "checklist", "bug", "camera", "flag",
] as const);
export type WorkflowIconName = (typeof WORKFLOW_ICON_NAMES)[number];

export const WORKFLOW_STEP_STATUSES = Object.freeze(["not_started", "running", "done", "failed", "needs_input"] as const);
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

/** Bounds the server enforces; the editor shows them before it refuses. */
export const WORKFLOW_CLIENT_LIMITS = Object.freeze({
  maxSteps: 50,
  maxNameChars: 120,
  maxTitleChars: 120,
  maxDescriptionChars: 1024,
  maxPromptBytes: 8 * 1024,
  maxSerializedBytes: 56 * 1024,
  maxCategoryChars: 64,
});

export interface WorkflowTemplateStep {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly icon: WorkflowIconName | "";
}

export interface WorkflowTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly openingPrompt: string;
  readonly steps: readonly WorkflowTemplateStep[];
}

export interface WorkflowTemplateState {
  readonly revision: number;
  readonly cursor: string;
  readonly categories: readonly string[];
  readonly templates: readonly WorkflowTemplate[];
}

export interface WorkflowStep extends WorkflowTemplateStep {
  readonly status: WorkflowStepStatus;
  readonly note: string;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
}

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly openingPrompt: string;
  readonly templateId: string | null;
  readonly createdAt: number;
  readonly steps: readonly WorkflowStep[];
}

export type SessionWorkflow =
  | {
      readonly sessionId: string;
      readonly state: "attached";
      readonly workflow: Workflow;
      readonly resumeStepId: string | null;
      readonly unfinished: boolean;
    }
  | { readonly sessionId: string; readonly state: "unrestorable" };

/** The exact terminal a workflow command names. */
export interface WorkflowTarget {
  readonly serverId: string;
  readonly projectId: string;
  readonly sessionId: string;
}

export interface WorkflowEventTransport extends QueryCommandTransport {
  readonly subscribe?: (event: string, listener: (payload: JsonValue) => void, onResync?: () => void) => () => void;
}

/** The serialized size the server bounds: the JSON of name, opening prompt and steps. */
export function workflowSerializedSize(content: {
  readonly name: string;
  readonly openingPrompt: string;
  readonly steps: readonly { readonly title: string; readonly prompt: string; readonly icon: string }[];
}): number {
  return new TextEncoder().encode(
    JSON.stringify({
      name: content.name,
      openingPrompt: content.openingPrompt,
      steps: content.steps.map(({ title, prompt, icon }) => ({ title, prompt, icon })),
    }),
  ).byteLength;
}

/** The current workflow id a `workflow_exists` refusal names, or undefined for any other error. */
export function existingWorkflowOf(error: unknown): { readonly workflowId: string | null } | undefined {
  const details = workflowErrorDetails(error);
  if (details === undefined || details.reason !== "workflow_exists") return undefined;
  return { workflowId: typeof details.workflowId === "string" ? details.workflowId : null };
}

/** The `details` of a server refusal, looking through the wrappers a facade adds. */
export function workflowErrorDetails(error: unknown): Readonly<Record<string, JsonValue>> | undefined {
  for (let current = error, depth = 0; current !== null && current !== undefined && depth < 8; depth += 1) {
    const details = (current as { details?: unknown }).details;
    if (isRecord(details)) return details as Readonly<Record<string, JsonValue>>;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** The protocol code of a server refusal, looking through the wrappers a facade adds. */
export function workflowErrorCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current !== null && current !== undefined && depth < 8; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Shared facade over a server's workflow templates and terminal workflows. */
export class WorkflowClient {
  constructor(private readonly transport: WorkflowEventTransport) {}

  async templates(options: QueryOptions = {}): Promise<WorkflowTemplateState> {
    return validateTemplateState(await this.transport.query<JsonValue>(WORKFLOW_OPERATIONS.templatesGet, {}, options));
  }

  async upsertTemplate(template: WorkflowTemplateInput, options: CommandOptions = {}): Promise<WorkflowTemplateState> {
    return validateTemplateState(
      await this.transport.command<JsonValue>(WORKFLOW_OPERATIONS.templatesUpsert, { template: asJson(template) }, options),
    );
  }

  async removeTemplate(templateId: string, options: CommandOptions = {}): Promise<WorkflowTemplateState> {
    return validateTemplateState(
      await this.transport.command<JsonValue>(WORKFLOW_OPERATIONS.templatesRemove, { templateId: boundedId(templateId) }, options),
    );
  }

  /** Order the templates, and optionally the categories; the order is the Command Bar's. */
  async reorderTemplates(
    templateIds: readonly string[],
    categories?: readonly string[],
    options: CommandOptions = {},
  ): Promise<WorkflowTemplateState> {
    return validateTemplateState(
      await this.transport.command<JsonValue>(
        WORKFLOW_OPERATIONS.templatesReorder,
        { templateIds: templateIds.map(boundedId), ...(categories === undefined ? {} : { categories: [...categories] }) },
        options,
      ),
    );
  }

  async replaceTemplates(
    templates: readonly WorkflowTemplateInput[],
    categories?: readonly string[],
    options: CommandOptions = {},
  ): Promise<WorkflowTemplateState> {
    return validateTemplateState(
      await this.transport.command<JsonValue>(
        WORKFLOW_OPERATIONS.templatesReplace,
        { templates: templates.map(asJson), ...(categories === undefined ? {} : { categories: [...categories] }) },
        options,
      ),
    );
  }

  /** The workflows of every terminal this client can see. */
  async list(options: QueryOptions = {}): Promise<readonly SessionWorkflow[]> {
    const result = await this.transport.query<JsonValue>(WORKFLOW_OPERATIONS.list, {}, options);
    if (!isRecord(result) || !Array.isArray(result.workflows)) throw new TypeError("workflows response is invalid");
    return Object.freeze(result.workflows.flatMap((value) => {
      const view = validateSessionWorkflow(value);
      return view === undefined ? [] : [view];
    }));
  }

  /** Attach a template to a terminal and type its launch text once. */
  async launch(
    templateId: string,
    target: WorkflowTarget,
    replaceWorkflowId?: string,
    options: CommandOptions = {},
  ): Promise<SessionWorkflow | undefined> {
    return validateSessionWorkflow(
      await this.transport.command<JsonValue>(
        WORKFLOW_OPERATIONS.launch,
        {
          templateId: boundedId(templateId),
          target: targetPayload(target),
          ...(replaceWorkflowId === undefined ? {} : { replaceWorkflowId: boundedId(replaceWorkflowId) }),
        },
        options,
      ),
    );
  }

  async resume(target: WorkflowTarget, options: CommandOptions = {}): Promise<void> {
    await this.transport.command(WORKFLOW_OPERATIONS.resume, { target: targetPayload(target) }, options);
  }

  async remove(target: WorkflowTarget, options: CommandOptions = {}): Promise<void> {
    await this.transport.command(WORKFLOW_OPERATIONS.remove, { target: targetPayload(target) }, options);
  }

  /** Called on every workflow change and on a notice that changes were missed. */
  onChanged(listener: () => void): () => void {
    return this.subscribe(WORKFLOW_EVENTS.changed, listener);
  }

  onTemplatesChanged(listener: () => void): () => void {
    return this.subscribe(WORKFLOW_EVENTS.templatesChanged, listener);
  }

  private subscribe(event: string, listener: () => void): () => void {
    if (typeof listener !== "function") throw new TypeError("workflow listener is required");
    const subscribe = this.transport.subscribe;
    if (typeof subscribe !== "function") throw new Error("workflow subscription is unavailable");
    return subscribe.call(this.transport, event, () => listener(), () => listener());
  }
}

/** A template as the editor sends it; ids of new steps may be left out. */
export interface WorkflowTemplateInput {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly openingPrompt: string;
  readonly steps: readonly { readonly id?: string; readonly title: string; readonly prompt: string; readonly icon: string }[];
}

const MAX_ID = 128;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function boundedId(value: string): string {
  if (typeof value !== "string" || value.length > MAX_ID || !ID_PATTERN.test(value)) throw new TypeError("workflow id is invalid");
  return value;
}

function targetPayload(target: WorkflowTarget): JsonValue {
  return { serverId: target.serverId, projectId: boundedId(target.projectId), sessionId: boundedId(target.sessionId) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function icon(value: unknown): WorkflowIconName | "" {
  return (WORKFLOW_ICON_NAMES as readonly string[]).includes(value as string) ? (value as WorkflowIconName) : "";
}

function time(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validateTemplateStep(value: unknown): WorkflowTemplateStep | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") return undefined;
  return Object.freeze({ id: value.id, title: text(value.title, 256), prompt: text(value.prompt, 16 * 1024), icon: icon(value.icon) });
}

function validateTemplateState(value: unknown): WorkflowTemplateState {
  if (!isRecord(value) || !Array.isArray(value.templates) || typeof value.revision !== "number") throw new TypeError("workflow templates are invalid");
  const templates = value.templates.flatMap((candidate): WorkflowTemplate[] => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !Array.isArray(candidate.steps)) return [];
    return [Object.freeze({
      id: candidate.id,
      name: text(candidate.name, 256),
      description: text(candidate.description, 4096),
      category: text(candidate.category, 256),
      openingPrompt: text(candidate.openingPrompt, 16 * 1024),
      steps: Object.freeze(candidate.steps.flatMap((step) => {
        const valid = validateTemplateStep(step);
        return valid === undefined ? [] : [valid];
      })),
    })];
  });
  return Object.freeze({
    revision: value.revision,
    cursor: typeof value.cursor === "string" ? value.cursor : String(value.revision),
    categories: Object.freeze(Array.isArray(value.categories) ? value.categories.filter((item): item is string => typeof item === "string") : []),
    templates: Object.freeze(templates),
  });
}

function validateStatus(value: unknown): WorkflowStepStatus {
  return (WORKFLOW_STEP_STATUSES as readonly string[]).includes(value as string) ? (value as WorkflowStepStatus) : "not_started";
}

/** A session's workflow, or undefined when it has none. */
export function validateSessionWorkflow(value: unknown): SessionWorkflow | undefined {
  if (!isRecord(value) || typeof value.sessionId !== "string") return undefined;
  if (value.state === "unrestorable") return Object.freeze({ sessionId: value.sessionId, state: "unrestorable" });
  if (value.state !== "attached" || !isRecord(value.workflow)) return undefined;
  const workflow = value.workflow;
  if (typeof workflow.id !== "string" || !Array.isArray(workflow.steps)) return undefined;
  const steps = workflow.steps.flatMap((step): WorkflowStep[] => {
    const base = validateTemplateStep(step);
    if (base === undefined || !isRecord(step)) return [];
    return [Object.freeze({
      ...base,
      status: validateStatus(step.status),
      note: text(step.note, 256),
      startedAt: time(step.startedAt),
      endedAt: time(step.endedAt),
    })];
  });
  return Object.freeze({
    sessionId: value.sessionId,
    state: "attached",
    workflow: Object.freeze({
      id: workflow.id,
      name: text(workflow.name, 256),
      openingPrompt: text(workflow.openingPrompt, 16 * 1024),
      templateId: typeof workflow.templateId === "string" ? workflow.templateId : null,
      createdAt: time(workflow.createdAt) ?? 0,
      steps: Object.freeze(steps),
    }),
    resumeStepId: typeof value.resumeStepId === "string" ? value.resumeStepId : null,
    unfinished: value.unfinished === true,
  });
}
