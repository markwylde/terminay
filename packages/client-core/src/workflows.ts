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
  updateStep: "workflow.update-step",
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

export const WORKFLOW_STEP_STATUSES = Object.freeze(["not_started", "running", "done", "failed", "needs_input", "skipped"] as const);
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
  /** Dependencies across every step of one template or workflow (ADR-0128). */
  maxDependencies: 200,
});

/** The length of a server-assigned step id, as the size bound counts one. */
const SERVER_STEP_ID_CHARS = 41;

export interface WorkflowTemplateStep {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly icon: WorkflowIconName | "";
  /** Ids of earlier steps this step waits on, in step order (ADR-0128). */
  readonly after: readonly string[];
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
      /** Steps not started or failed whose dependencies are all settled. */
      readonly readyStepIds: readonly string[];
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

/**
 * The serialized size the server bounds: the JSON of name, opening prompt and
 * steps, with each step's `after` counted as server ids where it is not the
 * default (the step above), as the server counts it (ADR-0128).
 */
export function workflowSerializedSize(content: {
  readonly name: string;
  readonly openingPrompt: string;
  readonly steps: readonly {
    readonly id?: string;
    readonly title: string;
    readonly prompt: string;
    readonly icon: string;
    readonly after?: readonly string[];
  }[];
}): number {
  const placeholder = "s".repeat(SERVER_STEP_ID_CHARS);
  return new TextEncoder().encode(
    JSON.stringify({
      name: content.name,
      openingPrompt: content.openingPrompt,
      steps: content.steps.map(({ title, prompt, icon, after }, index) => ({
        title,
        prompt,
        icon,
        ...(isDefaultAfter(content.steps, index, after) ? {} : { after: (after ?? []).map(() => placeholder) }),
      })),
    }),
  ).byteLength;
}

/** Whether `after` is what a step given without one gets: the step above. */
export function isDefaultAfter(
  steps: readonly { readonly id?: string }[],
  index: number,
  after: readonly string[] | undefined,
): boolean {
  if (after === undefined) return true;
  if (index === 0) return after.length === 0;
  return after.length === 1 && after[0] === steps[index - 1]?.id;
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

  /**
   * Set one step's status. `expectedStatus` makes the update apply only while
   * the step still holds it; otherwise the server refuses with `step_changed`.
   */
  async updateStep(
    target: WorkflowTarget,
    stepId: string,
    status: WorkflowStepStatus,
    update: { readonly note?: string; readonly expectedStatus?: WorkflowStepStatus } = {},
    options: CommandOptions = {},
  ): Promise<void> {
    await this.transport.command(
      WORKFLOW_OPERATIONS.updateStep,
      {
        target: targetPayload(target),
        stepId: boundedId(stepId),
        status,
        ...(update.note === undefined ? {} : { note: update.note }),
        ...(update.expectedStatus === undefined ? {} : { expectedStatus: update.expectedStatus }),
      },
      options,
    );
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
  readonly steps: readonly {
    readonly id?: string;
    readonly title: string;
    readonly prompt: string;
    readonly icon: string;
    /** Ids given to earlier steps of this input; absent means the step above. */
    readonly after?: readonly string[];
  }[];
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

function validateTemplateStep(value: unknown): Omit<WorkflowTemplateStep, "after"> & { readonly rawAfter: unknown } | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") return undefined;
  return { id: value.id, title: text(value.title, 256), prompt: text(value.prompt, 16 * 1024), icon: icon(value.icon), rawAfter: value.after };
}

/**
 * Steps with their dependencies: a step's `after` keeps only ids of steps
 * above it; a step without one waits on the step above (ADR-0128).
 */
function withDependencies<T extends { readonly id: string; readonly rawAfter: unknown }>(
  steps: readonly T[],
): (Omit<T, "rawAfter"> & { readonly after: readonly string[] })[] {
  const seen: string[] = [];
  return steps.map(({ rawAfter, ...step }, index) => {
    const after = Array.isArray(rawAfter)
      ? seen.filter((id) => rawAfter.includes(id))
      : index === 0
        ? []
        : [seen[index - 1] as string];
    seen.push(step.id);
    return Object.freeze({ ...step, after: Object.freeze(after) }) as Omit<T, "rawAfter"> & { readonly after: readonly string[] };
  });
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
      steps: Object.freeze(withDependencies(candidate.steps.flatMap((step) => {
        const valid = validateTemplateStep(step);
        return valid === undefined ? [] : [valid];
      }))),
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
  const steps: readonly WorkflowStep[] = withDependencies(workflow.steps.flatMap((step) => {
    const base = validateTemplateStep(step);
    if (base === undefined || !isRecord(step)) return [];
    return [{
      ...base,
      status: validateStatus(step.status),
      note: text(step.note, 256),
      startedAt: time(step.startedAt),
      endedAt: time(step.endedAt),
    }];
  }));
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
    readyStepIds: Object.freeze(Array.isArray(value.readyStepIds) ? value.readyStepIds.filter((id): id is string => typeof id === "string") : []),
    unfinished: value.unfinished === true,
  });
}
