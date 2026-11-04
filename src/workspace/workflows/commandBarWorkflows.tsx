/**
 * Workflows in the Command Bar (ADR-0097): the templates of the server that
 * owns the active terminal, Resume for its unfinished workflow, and the
 * confirmation before an unfinished workflow is replaced. Only that server is
 * ever addressed.
 */

import {
	existingWorkflowOf,
	type SessionWorkflow,
	type WorkflowClient,
	type WorkflowTarget,
	type WorkflowTemplate,
	type WorkflowTemplateState,
} from '@terminay/client-core';
import { ListChecks, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandBarItem } from '../CommandBar';
import type { ServerWorkflows } from './useServerWorkflows';

export const WORKFLOW_COMMAND_GROUP = 'Workflows';
export const WORKFLOW_GROUP_KEY_PREFIX = 'workflow-category:';
export const WORKFLOW_RESUME_GROUP_KEY = 'workflow-resume';

/** The Command Bar group of a template: its category in category order, or "Workflows" last. */
export function workflowCommandGroup(
	category: string,
	categories: readonly string[],
): Pick<CommandBarItem, 'group' | 'groupKey' | 'groupOrder'> {
	const position = categories.indexOf(category);
	return position === -1
		? { group: WORKFLOW_COMMAND_GROUP, groupKey: WORKFLOW_COMMAND_GROUP, groupOrder: categories.length }
		: { group: category, groupKey: `${WORKFLOW_GROUP_KEY_PREFIX}${category}`, groupOrder: position };
}

/** Templates in category order, keeping saved order within a category. */
function orderTemplates(state: WorkflowTemplateState): WorkflowTemplate[] {
	const rank = (template: WorkflowTemplate) => {
		const position = state.categories.indexOf(template.category);
		return position === -1 ? state.categories.length : position;
	};
	return state.templates
		.map((template, index) => ({ template, index }))
		.sort((left, right) => rank(left.template) - rank(right.template) || left.index - right.index)
		.map(({ template }) => template);
}

const unfinishedOf = (view: SessionWorkflow | undefined) =>
	view?.state === 'attached' && view.unfinished ? view : undefined;

export function workflowCommandItems({
	templates,
	view,
	onLaunch,
	onResume,
}: Readonly<{
	templates: WorkflowTemplateState | undefined;
	view: SessionWorkflow | undefined;
	onLaunch: (template: WorkflowTemplate) => void;
	onResume: () => void;
}>): CommandBarItem[] {
	const items: CommandBarItem[] = [];
	const unfinished = unfinishedOf(view);
	if (unfinished !== undefined)
		items.push({
			group: 'Workflow',
			groupKey: WORKFLOW_RESUME_GROUP_KEY,
			groupOrder: -1,
			icon: <RotateCcw size={18} strokeWidth={2.1} />,
			id: 'workflow:resume',
			title: 'Resume workflow',
			description: unfinished.workflow.name,
			searchText: `resume workflow continue goal ${unfinished.workflow.name}`.toLowerCase(),
			shortcutLabel: '',
			onSelect: onResume,
		});
	if (templates === undefined) return items;
	for (const template of orderTemplates(templates))
		items.push({
			...workflowCommandGroup(template.category, templates.categories),
			icon: <ListChecks size={18} strokeWidth={2.1} />,
			id: `workflow:${template.id}`,
			title: template.name,
			description:
				template.description ||
				`${template.steps.length} ${template.steps.length === 1 ? 'step' : 'steps'}`,
			searchText: [
				'workflow',
				template.name,
				template.description,
				template.category,
				...template.steps.map((step) => step.title),
			]
				.join(' ')
				.toLowerCase(),
			shortcutLabel: '',
			onSelect: () => onLaunch(template),
		});
	return items;
}

export type LaunchDependencies = Readonly<{
	client: Pick<WorkflowClient, 'launch' | 'list'>;
	target: WorkflowTarget;
	/** The terminal's workflow as last seen. */
	current: SessionWorkflow | undefined;
	/** Ask whether to replace the named unfinished workflow. */
	confirm: (workflowName: string) => Promise<boolean>;
}>;

/**
 * Launch a template on the target terminal. An unfinished workflow is
 * replaced only once the user confirms that very workflow; when the server
 * says another is now attached, the user is asked again about that one.
 */
export async function launchWorkflow(
	deps: LaunchDependencies,
	templateId: string,
): Promise<'launched' | 'cancelled'> {
	let current = deps.current;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const unfinished = unfinishedOf(current);
		let replaceWorkflowId: string | undefined;
		if (unfinished !== undefined) {
			if (!(await deps.confirm(unfinished.workflow.name))) return 'cancelled';
			replaceWorkflowId = unfinished.workflow.id;
		}
		try {
			await deps.client.launch(templateId, deps.target, replaceWorkflowId);
			return 'launched';
		} catch (error) {
			if (existingWorkflowOf(error) === undefined) throw error;
			const workflows = await deps.client.list();
			current = workflows.find((view) => view.sessionId === deps.target.sessionId);
		}
	}
	throw new Error('The terminal’s workflow kept changing; try again.');
}

type PendingConfirm = Readonly<{ name: string; resolve: (replace: boolean) => void }>;

/**
 * The Command Bar's workflow entries for the active terminal, and the dialog
 * that confirms a replace. `isOpen` re-reads the active terminal each time
 * the Command Bar opens.
 */
export function useWorkflowCommands({
	servers,
	serverId,
	projectId,
	isOpen,
	getActiveSessionId,
	close,
	focusTerminal,
	onError,
}: Readonly<{
	servers: ReadonlyMap<string, ServerWorkflows>;
	serverId: string | undefined;
	projectId: string;
	isOpen: boolean;
	getActiveSessionId: () => string | null | undefined;
	close: () => void;
	focusTerminal: () => void;
	onError: (message: string) => void;
}>) {
	const [pending, setPending] = useState<PendingConfirm | null>(null);
	const server = serverId === undefined ? undefined : servers.get(serverId);
	const serverRef = useRef(server);
	serverRef.current = server;

	const items = useMemo(() => {
		if (!isOpen || server === undefined) return [];
		const sessionId = getActiveSessionId();
		if (sessionId === null || sessionId === undefined) return [];
		const target: WorkflowTarget = { serverId: server.serverId, projectId, sessionId };
		const run = (action: () => Promise<unknown>) => {
			close();
			void action().then(
				() => focusTerminal(),
				(error: unknown) =>
					onError(`Workflow: ${error instanceof Error ? error.message : String(error)}`),
			);
		};
		return workflowCommandItems({
			templates: server.templates,
			view: server.workflows.get(sessionId),
			onResume: () => run(() => server.client.resume(target)),
			onLaunch: (template) =>
				run(() =>
					launchWorkflow(
						{
							client: server.client,
							target,
							// The newest view, which may have changed since the bar opened.
							current: serverRef.current?.workflows.get(sessionId),
							confirm: (name) =>
								new Promise<boolean>((resolve) => setPending({ name, resolve })),
						},
						template.id,
					),
				),
		});
	}, [close, focusTerminal, getActiveSessionId, isOpen, onError, projectId, server]);

	const settle = useCallback(
		(replace: boolean) => {
			setPending((current) => {
				current?.resolve(replace);
				return null;
			});
			if (!replace) focusTerminal();
		},
		[focusTerminal],
	);

	const dialog =
		pending === null ? null : (
			<WorkflowReplaceDialog name={pending.name} onSettle={settle} />
		);
	return { items, dialog } as const;
}

export function WorkflowReplaceDialog({
	name,
	onSettle,
}: Readonly<{ name: string; onSettle: (replace: boolean) => void }>) {
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		cancelRef.current?.focus();
	}, []);
	return (
		<div className="workflow-confirm-overlay">
			<div
				className="workflow-confirm"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="workflow-confirm-title"
				aria-describedby="workflow-confirm-body"
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.key === 'Escape') {
						event.preventDefault();
						onSettle(false);
					}
				}}
			>
				<h2 id="workflow-confirm-title">Replace “{name}”?</h2>
				<p id="workflow-confirm-body">
					This terminal’s workflow is not finished. Launching replaces it and its progress.
				</p>
				<div className="workflow-confirm-actions">
					<button ref={cancelRef} type="button" onClick={() => onSettle(false)}>
						Cancel
					</button>
					<button type="button" className="workflow-confirm-replace" onClick={() => onSettle(true)}>
						Replace
					</button>
				</div>
			</div>
		</div>
	);
}
