import {
	type TerminayClient,
	TerminayClientFacade,
	WORKFLOWS_CAPABILITY,
	WorkflowClient,
} from '@terminay/client-core';
import { useEffect, useMemo, useState } from 'react';
import type { WorkflowsUnavailable } from '../settings/WorkflowsCategory';

/** Whether a connection's negotiated capabilities include workflows. */
export function workflowsStateOf(
	client: Pick<TerminayClient, 'snapshot'> | undefined,
): WorkflowsUnavailable | undefined {
	if (client === undefined) return 'disconnected';
	const capabilities = client.snapshot.negotiated?.capabilities;
	if (capabilities === undefined) return 'disconnected';
	return capabilities.includes(WORKFLOWS_CAPABILITY) ? undefined : 'incompatible';
}

/**
 * The workflow client of the server chosen in Settings, and why it is not
 * usable when it is not. Only that server is ever addressed.
 */
export function useWorkflowSettingsClient(applicationClient: TerminayClient | undefined) {
	const [unavailable, setUnavailable] = useState(() => workflowsStateOf(applicationClient));
	useEffect(() => {
		setUnavailable(workflowsStateOf(applicationClient));
		if (applicationClient === undefined) return undefined;
		return applicationClient.onStateChange(() => setUnavailable(workflowsStateOf(applicationClient)));
	}, [applicationClient]);
	const client = useMemo(
		() =>
			applicationClient === undefined || unavailable !== undefined
				? undefined
				: new WorkflowClient(new TerminayClientFacade(applicationClient)),
		[applicationClient, unavailable],
	);
	return { client, unavailable } as const;
}
