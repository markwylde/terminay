import {
	ServerDesktopClient,
	type ServerDesktopClientTransport,
} from '@terminay/client-core';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ServerDesktopHubProvider } from '../../src/workspace/serverDesktop/ServerDesktopHub';
import { ServerDesktopDropdown } from '../../src/workspace/serverDesktop/ServerDesktopSurfaces';
import { ServerDesktopButton } from '../../src/workspace/serverDesktop/ServerDesktopViews';

/**
 * The header control and its dropdown as a browser client mounts them,
 * over a server that answers as a Debian host before setup does. The client
 * and both components are the production ones; only the wire is a stand-in.
 */
function serverBeforeSetup(): ServerDesktopClientTransport {
	let status: Record<string, unknown> = {
		state: 'needs-setup',
		setup: 'server',
		command: 'sudo terminay daemon desktop install',
	};
	const never = (): never => {
		throw new Error('The fixture server has no desktop to stream.');
	};
	const transport = {
		query: async (operation: string) => {
			if (operation !== 'server.desktop.status') return never();
			return { status, controller: null };
		},
		command: async (operation: string) => {
			if (operation !== 'server.desktop.setup') return never();
			status = { state: 'setting-up', step: 'preparing', fraction: 0.1 };
			return { status };
		},
		queryWithBody: never,
		commandWithBody: never,
		subscribe: () => () => undefined,
	};
	return transport as unknown as ServerDesktopClientTransport;
}

function Fixture() {
	const client = useMemo(
		() => new ServerDesktopClient(serverBeforeSetup()),
		[],
	);
	const [open, setOpen] = useState(false);
	return (
		<ServerDesktopHubProvider
			client={client}
			serverId="studio"
			serverLabel="studio.example"
		>
			<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
				<ServerDesktopButton
					serverLabel="studio.example"
					isOpen={open}
					onActivate={() => setOpen((was) => !was)}
				>
					{open ? (
						<ServerDesktopDropdown
							onDismiss={() => setOpen(false)}
							onOpenTab={() => setOpen(false)}
						/>
					) : null}
				</ServerDesktopButton>
			</div>
		</ServerDesktopHubProvider>
	);
}

const root = document.getElementById('server-desktop-root');
if (root === null) throw new Error('Missing server desktop root');
createRoot(root).render(<Fixture />);
