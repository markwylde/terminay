/**
 * The activity note for one Terminay MCP call a chat made, in Terminay's own
 * words. It names the terminal by its display title and quotes what the
 * agent asked to type or run, never anything a terminal printed.
 */
export function describeChatMcpCall(
	operation: string,
	params: Readonly<Record<string, unknown>>,
	terminalTitle: (reference: string) => string | undefined,
): string | undefined {
	const terminal = (): string => {
		const reference =
			typeof params.terminal === 'string' ? params.terminal : '';
		return (
			(reference === '' ? undefined : terminalTitle(reference)) ?? 'a terminal'
		);
	};
	const quoted = (value: unknown, maximum = 80): string => {
		const text =
			typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
		return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
	};
	const name = (): string => {
		const value = quoted(params.name, 60);
		return value === '' ? 'an automation' : `the automation “${value}”`;
	};
	switch (operation) {
		case 'get_mcp_capabilities':
			return undefined;
		case 'list_terminals':
			return 'Looking at the terminals';
		case 'read_terminal':
			return `Reading ${terminal()}`;
		case 'search_terminal':
			return `Searching ${terminal()}`;
		case 'get_terminal_status':
			return `Checking ${terminal()}`;
		case 'write_terminal':
			return `Typing into ${terminal()}`;
		case 'run_command': {
			const command = quoted(params.command);
			return command === ''
				? `Running a command in ${terminal()}`
				: `Running \`${command}\` in ${terminal()}`;
		}
		case 'open_terminal':
			return 'Opening a terminal';
		case 'close_terminal':
			return `Closing ${terminal()}`;
		case 'focus_terminal':
			return `Switching to ${terminal()}`;
		case 'rename_terminal':
			return `Renaming ${terminal()}`;
		case 'split_terminal':
			return `Opening a terminal beside ${terminal()}`;
		case 'get_layout':
			return 'Looking at the layout';
		case 'focus_tab':
			return 'Switching tabs';
		case 'move_tab':
			return 'Moving a tab';
		case 'resize_pane':
			return 'Resizing a pane';
		case 'arrange_tabs':
			return `Arranging tabs into ${
				params.arrangement === 'grid'
					? 'a grid'
					: params.arrangement === 'tabs'
						? 'one pane'
						: params.arrangement === 'rows'
							? 'rows'
							: 'columns'
			}`;
		case 'focus_project':
			return 'Switching project';
		case 'select_folder':
			return 'Switching folder';
		case 'create_folder': {
			const folder = quoted(params.name, 60);
			return folder === '' ? 'Creating a folder' : `Creating the folder “${folder}”`;
		}
		case 'rename_folder':
			return 'Renaming a folder';
		case 'move_tab_to_folder':
			return 'Moving a tab to a folder';
		case 'open_file':
			return 'Opening a file';
		case 'close_tab':
			return 'Closing a tab';
		case 'wait_for_idle':
			return `Waiting for ${terminal()} to go quiet`;
		case 'wait_for_command':
			return `Waiting for a command to finish in ${terminal()}`;
		case 'wait_for_attention':
			return `Waiting for ${terminal()} to need attention`;
		case 'list_automations':
			return 'Looking at automations';
		case 'get_automation':
		case 'list_automation_runs':
			return 'Reading an automation';
		case 'create_automation':
			return `Creating ${name()}`;
		case 'update_automation':
			return 'Changing an automation';
		case 'delete_automation':
			return 'Deleting an automation';
		case 'set_automation_enabled':
			return params.enabled === false
				? 'Turning an automation off'
				: 'Turning an automation on';
		case 'run_automation':
			return 'Running an automation';
		case 'stop_automation_run':
			return 'Stopping an automation run';
		case 'list_projects':
			return 'Looking at the projects';
		case 'create_project': {
			const project = quoted(params.name, 60);
			return project === ''
				? 'Creating a project'
				: `Creating the project “${project}”`;
		}
		case 'update_project':
			return 'Changing a project';
		case 'move_project':
			return 'Moving a project';
		case 'close_project':
			return 'Closing a project';
		case 'list_workspace_windows':
			return 'Looking at the windows';
		case 'open_workspace_window':
			return 'Opening a window';
		case 'rename_workspace_window':
			return 'Renaming a window';
		case 'close_workspace_window':
			return 'Closing a window';
		default:
			return `Using ${operation.replace(/[^\w.:-]/g, '').slice(0, 64)}`;
	}
}
