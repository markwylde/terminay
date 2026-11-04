import type { ProtocolId } from '@terminay/protocol';

/**
 * Workflows (ADR-0097): templates are user-authored, ordered checklists; a
 * workflow is a copy of one bound to a single terminal session, whose steps an
 * agent reports on. Terminay never runs a step.
 */

export const WORKFLOW_TEMPLATE_SCHEMA_VERSION = 1;
export const WORKFLOW_RECORD_SCHEMA_VERSION = 1;

/** The bounds shared by templates and workflows. */
export const WORKFLOW_LIMITS = Object.freeze({
	maxSteps: 50,
	/** Characters (code points). */
	maxNameChars: 120,
	maxTitleChars: 120,
	maxDescriptionChars: 1024,
	/** UTF-8 bytes. */
	maxPromptBytes: 8 * 1024,
	/**
	 * Bytes of the JSON encoding of name, opening prompt and steps (title,
	 * prompt, icon) as a `create_workflow` request carries them. Leaves 8 KiB
	 * of the 64 KiB ordinary MCP frame for the envelope.
	 */
	maxSerializedBytes: 56 * 1024,
	maxNoteChars: 200,
	/** UTF-8 bytes of the text typed on launch or resume. */
	maxLaunchTextBytes: 16 * 1024,
	maxTemplates: 512,
	maxCategories: 64,
	maxCategoryChars: 64,
});

/** Icon names a step may carry. The client draws them; nothing else does. */
export const WORKFLOW_ICON_NAMES = Object.freeze([
	'lightbulb',
	'eye',
	'wrench',
	'code',
	'flask',
	'archive',
	'pull-request',
	'terminal',
	'checklist',
	'bug',
	'camera',
	'flag',
] as const);

export type WorkflowIconName = (typeof WORKFLOW_ICON_NAMES)[number];

export const WORKFLOW_STEP_STATUSES = Object.freeze([
	'not_started',
	'running',
	'done',
	'failed',
	'needs_input',
] as const);

export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export interface WorkflowTemplateStep {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
	/** Empty for none. */
	readonly icon: WorkflowIconName | '';
}

export interface WorkflowTemplate {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	/** Name of a listed category, or empty for none. */
	readonly category: string;
	readonly openingPrompt: string;
	readonly steps: readonly WorkflowTemplateStep[];
}

export interface WorkflowTemplateState {
	readonly schemaVersion: number;
	readonly revision: number;
	readonly cursor: string;
	readonly categories: readonly string[];
	readonly templates: readonly WorkflowTemplate[];
}

export interface WorkflowStep {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
	readonly icon: WorkflowIconName | '';
	readonly status: WorkflowStepStatus;
	/** Empty for none. */
	readonly note: string;
	/** Epoch milliseconds, or null. */
	readonly startedAt: number | null;
	readonly endedAt: number | null;
}

export interface Workflow {
	readonly id: string;
	readonly name: string;
	readonly openingPrompt: string;
	/** The template it was launched from, if any. */
	readonly templateId: string | null;
	readonly createdAt: number;
	readonly steps: readonly WorkflowStep[];
}

/** What a session's file holds. */
export type SessionWorkflowRecord =
	| {
			readonly schemaVersion: number;
			readonly sessionId: string;
			readonly workflow: Workflow;
	  }
	| {
			readonly schemaVersion: number;
			readonly sessionId: string;
			readonly workflow: null;
	  };

/** What clients and MCP see for one session. */
export type SessionWorkflowView =
	| {
			readonly sessionId: string;
			readonly state: 'attached';
			readonly workflow: Workflow;
			readonly resumeStepId: string | null;
			readonly unfinished: boolean;
	  }
	| { readonly sessionId: string; readonly state: 'unrestorable' };

export interface WorkflowTemplateBackend {
	load(): Promise<unknown | undefined>;
	commit(state: WorkflowTemplateState): Promise<void>;
}

export type WorkflowTemplateCommand =
	| { readonly type: 'upsert'; readonly template: unknown }
	| { readonly type: 'remove'; readonly templateId: string }
	| {
			readonly type: 'reorder';
			readonly templateIds: readonly unknown[];
			/** Absent keeps the stored categories. */
			readonly categories?: readonly unknown[];
	  }
	| {
			readonly type: 'replace';
			readonly templates: readonly unknown[];
			/** Absent keeps the stored categories. */
			readonly categories?: readonly unknown[];
	  };

export interface WorkflowTemplateCommandEnvelope {
	readonly commandId?: ProtocolId;
	readonly expectedRevision?: number;
	readonly command: WorkflowTemplateCommand;
}

export type WorkflowTemplateApplyResult =
	| {
			readonly ok: true;
			readonly revision: number;
			readonly cursor: string;
			readonly state: WorkflowTemplateState;
	  }
	| {
			readonly ok: false;
			readonly conflict: {
				readonly code: 'conflict';
				readonly currentRevision: number;
				readonly currentCursor: string;
				readonly message: string;
			};
	  };

/** A step as supplied to create a workflow or template. */
export interface WorkflowStepInput {
	readonly id?: unknown;
	readonly title?: unknown;
	readonly prompt?: unknown;
	readonly icon?: unknown;
}

export interface WorkflowInput {
	readonly name?: unknown;
	readonly openingPrompt?: unknown;
	readonly steps?: unknown;
}
