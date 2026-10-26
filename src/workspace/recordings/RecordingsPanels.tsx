/**
 * Home's recording tabs.
 *
 * Recordings are server-owned terminal captures. The Recordings section is the
 * timeline of one server's — the one the window works in unless a person picks
 * another, chosen the way the Automations section chooses — and never merges
 * two servers' timelines. Each recording a person opens is a Home tab of its
 * own, so the timeline stays where it was and several replays can be open at
 * once. Closing a replay tab deletes nothing.
 *
 * Every panel talks to its server through that connection's canonical
 * `RecordingsClient`; only the frame around the timeline is Home's.
 */

import { RecordingsClient, TerminayClientFacade } from '@terminay/client-core';
import { FEATURE_CAPABILITIES } from '@terminay/protocol';
import { useMemo, useState } from 'react';
import {
	RecordingReplay,
	RecordingsTimeline,
} from '../../components/RecordingsWindow';
import type { WorkspaceConnectionContext } from '../../shared/connections/connectionRegistry';
import type { AutomationsSectionServer } from '../automations/AutomationPanels';
import { selectAutomationServer } from '../automations/automationsModel';

export function supportsRecordings(
	capabilities: readonly string[] | undefined,
): boolean {
	return capabilities?.includes(FEATURE_CAPABILITIES.recording) === true;
}

/** What a recording panel asks of the tab it is drawn in. */
export type RecordingTabHost = Readonly<{
	/** Open a recording's replay, or bring its tab to the front. */
	openRecording: (
		target: Readonly<{ serverId: string; recordingId: string }>,
	) => void;
	close: () => void;
	setTitle: (title: string) => void;
}>;

type RecordingsSectionData = Readonly<{
	servers: readonly AutomationsSectionServer[];
	/** The server the window is working in; the timeline's default choice. */
	workingServerId?: string;
}>;

function useRecordingsClient(
	context: WorkspaceConnectionContext | undefined,
): RecordingsClient | undefined {
	const applicationClient = context?.applicationClient;
	return useMemo(
		() =>
			applicationClient === undefined
				? undefined
				: new RecordingsClient(new TerminayClientFacade(applicationClient)),
		[applicationClient],
	);
}

export function RecordingsListPanel({
	data,
	host,
	isVisible,
}: Readonly<{
	data: RecordingsSectionData;
	host: RecordingTabHost;
	isVisible: boolean;
}>) {
	const { servers, workingServerId } = data;
	const [requestedServer, setRequestedServer] = useState<string>();
	const selection = useMemo(
		() =>
			selectAutomationServer(
				servers,
				requestedServer,
				workingServerId,
				supportsRecordings,
			),
		[requestedServer, servers, workingServerId],
	);
	const serverId = selection.selected?.serverId;
	const server = servers.find((candidate) => candidate.serverId === serverId);
	const client = useRecordingsClient(server?.context);

	if (serverId === undefined || client === undefined)
		return (
			<div className="home-section home-recordings" data-terminay-recordings>
				<header className="workspace-dashboard__header automations-header">
					<div className="workspace-dashboard__header-top">
						<div className="workspace-dashboard__heading-box automations-header__heading-box">
							<h2 className="workspace-dashboard__heading automations-header__title">
								Recordings
							</h2>
						</div>
					</div>
				</header>
				<p
					className="workspace-dashboard__empty automations-empty"
					data-terminay-recordings-unsupported="true"
				>
					{selection.unsupported.length === 0
						? 'Recordings appear here once a server is connected.'
						: `${selection.unsupported.map((choice) => choice.label).join(', ')} ${selection.unsupported.length === 1 ? 'does' : 'do'} not support recordings. Update Terminay Server there to use them.`}
				</p>
			</div>
		);

	const serverSelector = selection.showsSelector ? (
		<select
			className="recordings-server-select"
			aria-label="Server"
			value={serverId}
			onChange={(event) => setRequestedServer(event.target.value)}
			data-terminay-recordings-server-selector="true"
		>
			{selection.choices.map((choice) => (
				<option key={choice.serverId} value={choice.serverId}>
					{choice.label}
				</option>
			))}
		</select>
	) : null;

	return (
		<div className="home-section home-recordings" data-terminay-recordings>
			<RecordingsTimeline
				// A different server is a different timeline.
				key={serverId}
				client={client}
				headerAccessory={serverSelector}
				isVisible={isVisible}
				onOpen={({ recordingId }) =>
					host.openRecording({ serverId, recordingId })
				}
			/>
		</div>
	);
}

export function RecordingReplayPanel({
	data,
	host,
	recordingId,
	serverId,
}: Readonly<{
	data: RecordingsSectionData;
	host: RecordingTabHost;
	recordingId: string;
	serverId: string;
}>) {
	const server = data.servers.find(
		(candidate) => candidate.serverId === serverId,
	);
	const client = useRecordingsClient(server?.context);
	if (client === undefined)
		return (
			<p className="workspace-dashboard__empty automations-empty" role="status">
				{server === undefined
					? 'This recording’s server is not attached to this window.'
					: `${server.label} is not connected.`}
			</p>
		);
	return (
		<RecordingReplay
			client={client}
			recordingId={recordingId}
			onDeleted={host.close}
			onTitle={host.setTitle}
		/>
	);
}
