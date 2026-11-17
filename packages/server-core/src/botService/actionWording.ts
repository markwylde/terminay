/**
 * Terminay's own words for an action a bot took (ADR-0134): past tense when it
 * was done, "Couldn't …" when it failed. It names terminals and projects by
 * their display names and quotes only what the agent asked for, never any
 * output, setting value or result.
 */

export interface BotActionNames {
	/** The display title of the terminal a call named, when it resolved. */
	readonly terminal?: string;
	/** The display name of the project a call named, when it resolved. */
	readonly project?: string;
}

interface Phrase {
	/** Base form, e.g. "create". */
	readonly verb: string;
	/** Past form, e.g. "Created". */
	readonly past: string;
	/** What follows the verb, e.g. "the project “api”". */
	readonly rest: string;
}

function quoted(value: unknown, maximum: number): string {
	const text =
		typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
	const chars = [...text];
	return chars.length > maximum
		? `${chars.slice(0, maximum - 1).join('')}…`
		: text;
}

const PAST: Readonly<Record<string, string>> = {
	add: 'Added',
	arrange: 'Arranged',
	attach: 'Attached',
	cancel: 'Cancelled',
	change: 'Changed',
	clear: 'Cleared',
	close: 'Closed',
	create: 'Created',
	delete: 'Deleted',
	dismiss: 'Dismissed',
	move: 'Moved',
	open: 'Opened',
	rename: 'Renamed',
	reorder: 'Reordered',
	reset: 'Reset',
	resize: 'Resized',
	retry: 'Retried',
	run: 'Ran',
	save: 'Saved',
	send: 'Sent',
	show: 'Showed',
	start: 'Started',
	stop: 'Stopped',
	switch: 'Switched',
	'switch to': 'Switched to',
	'turn off': 'Turned off',
	'turn on': 'Turned on',
	'type into': 'Typed into',
	update: 'Updated',
	use: 'Used',
};

function phrase(verb: string, rest: string): Phrase {
	return { verb, past: PAST[verb] ?? verb, rest };
}

function phraseFor(
	tool: string,
	params: Readonly<Record<string, unknown>>,
	names: BotActionNames,
): Phrase {
	const terminal = names.terminal
		? `the terminal “${quoted(names.terminal, 60)}”`
		: 'a terminal';
	const project = names.project
		? `the project “${quoted(names.project, 60)}”`
		: 'a project';
	const named = (noun: string, value: unknown) => {
		const name = quoted(value, 60);
		return name === '' ? `a ${noun}` : `the ${noun} “${name}”`;
	};
	switch (tool) {
		case 'open_terminal':
			return phrase('open', 'a terminal');
		case 'split_terminal':
			return phrase('open', `a terminal beside ${terminal}`);
		case 'write_terminal':
			return phrase('type into', terminal);
		case 'run_command': {
			const command = quoted(params.command, 80);
			return phrase(
				'run',
				command === '' ? `a command in ${terminal}` : `\`${command}\` in ${terminal}`,
			);
		}
		case 'close_terminal':
			return phrase('close', terminal);
		case 'focus_terminal':
			return phrase('switch to', terminal);
		case 'rename_terminal': {
			const title = quoted(params.title ?? params.name, 60);
			return phrase(
				'rename',
				title === '' ? terminal : `${terminal} to “${title}”`,
			);
		}
		case 'update_terminal':
			return phrase('change', terminal);
		case 'move_terminal_to_project':
			return phrase('move', `${terminal} to another project`);
		case 'focus_tab':
			return phrase('switch', 'tabs');
		case 'move_tab':
			return phrase('move', 'a tab');
		case 'resize_pane':
			return phrase('resize', 'a pane');
		case 'arrange_tabs':
			return phrase(
				'arrange',
				`tabs into ${
					params.arrangement === 'grid'
						? 'a grid'
						: params.arrangement === 'tabs'
							? 'one pane'
							: params.arrangement === 'rows'
								? 'rows'
								: 'columns'
				}`,
			);
		case 'focus_project':
			return phrase('switch to', project);
		case 'focus_home':
			return phrase('show', 'Home');
		case 'select_folder':
			return phrase('switch', 'folder');
		case 'create_folder':
			return phrase('create', named('folder', params.name));
		case 'rename_folder':
			return phrase('rename', 'a folder');
		case 'delete_folder':
			return phrase('delete', 'a folder');
		case 'reorder_folders':
			return phrase('reorder', 'folders');
		case 'move_tab_to_folder':
			return phrase('move', 'a tab to a folder');
		case 'open_file':
			return phrase('open', 'a file');
		case 'close_tab':
			return phrase('close', 'a tab');
		case 'create_automation':
			return phrase(
				'create',
				named(
					'automation',
					(params.definition as Record<string, unknown> | undefined)?.name ??
						params.name,
				),
			);
		case 'update_automation':
			return phrase('change', 'an automation');
		case 'delete_automation':
			return phrase('delete', 'an automation');
		case 'set_automation_enabled':
			return phrase(
				params.enabled === false ? 'turn off' : 'turn on',
				'an automation',
			);
		case 'run_automation':
			return phrase('run', 'an automation');
		case 'stop_automation_run':
			return phrase('stop', 'an automation run');
		case 'remove_automation_run':
			return phrase('delete', 'an automation run');
		case 'prune_automation_runs':
			return phrase('clear', 'old automation runs');
		case 'dismiss_missed_runs':
			return phrase('dismiss', 'missed automation runs');
		case 'create_project':
			return phrase('create', named('project', params.name));
		case 'update_project':
			return phrase('change', project);
		case 'move_project':
			return phrase('move', project);
		case 'close_project':
			return phrase('close', project);
		case 'open_workspace_window':
			return phrase('open', 'a window');
		case 'rename_workspace_window':
			return phrase('rename', 'a window');
		case 'close_workspace_window':
			return phrase('close', 'a window');
		case 'update_settings': {
			const keys =
				typeof params.settings === 'object' && params.settings !== null
					? Object.keys(params.settings)
					: [];
			return phrase(
				'change',
				keys.length === 1
					? `the setting ${quoted(keys[0], 60)}`
					: 'settings',
			);
		}
		case 'save_shell_profile':
			return phrase('save', 'a shell profile');
		case 'delete_shell_profile':
			return phrase('delete', 'a shell profile');
		case 'reorder_shell_profiles':
			return phrase('reorder', 'shell profiles');
		case 'set_default_shell_profile':
			return phrase('change', 'the default shell profile');
		case 'run_macro':
			return phrase('run', `a macro in ${terminal}`);
		case 'cancel_macro':
			return phrase('cancel', 'a macro');
		case 'create_workflow':
			return phrase('attach', `a workflow to ${terminal}`);
		case 'update_workflow_step':
			return phrase('update', `a workflow step in ${terminal}`);
		case 'create_workflow_template':
			return phrase('save', named('workflow template', params.name));
		case 'update_workflow_template':
			return phrase('change', 'a workflow template');
		case 'delete_workflow_template':
			return phrase('delete', 'a workflow template');
		case 'send_notification':
			return phrase('send', 'a notification');
		case 'dismiss_notification':
			return phrase('dismiss', 'a notification');
		case 'call_connected_tool': {
			const name = quoted(params.tool ?? params.name, 60);
			return phrase('use', name === '' ? 'a connected tool' : `the tool ${name}`);
		}
		case 'triggers_create':
			return phrase(
				'create',
				named(
					'trigger',
					(params.draft as Record<string, unknown> | undefined)?.name,
				),
			);
		case 'triggers_update':
			return phrase('change', 'a trigger');
		case 'triggers_delete':
			return phrase('delete', 'a trigger');
		case 'triggers_enable':
			return phrase(params.enabled === false ? 'turn off' : 'turn on', 'a trigger');
		case 'triggers_run':
			return phrase('run', 'a trigger');
		case 'triggers_reset':
			return phrase('reset', 'a trigger');
		case 'triggers_retry':
			return phrase('retry', 'a trigger');
		default:
			return phrase('use', tool.replace(/[^\w.:-]/g, '').slice(0, 64));
	}
}

/** The description of one action, e.g. "Created the project “api”". */
export function describeBotAction(
	tool: string,
	params: Readonly<Record<string, unknown>>,
	outcome: 'done' | 'failed',
	names: BotActionNames = {},
): string {
	const { verb, past, rest } = phraseFor(tool, params, names);
	return outcome === 'done' ? `${past} ${rest}` : `Couldn't ${verb} ${rest}`;
}
