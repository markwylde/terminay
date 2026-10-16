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
			return `Splitting ${terminal()}`;
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
		default:
			return `Using ${operation.replace(/[^\w.:-]/g, '').slice(0, 64)}`;
	}
}
