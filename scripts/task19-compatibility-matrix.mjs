import { access } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const TASK19_SURFACES = Object.freeze([
	'local-desktop',
	'remote-desktop',
	'wide-web',
	'mobile-web',
]);

export const TASK19_ARCHITECTURE_EVIDENCE = Object.freeze([
	'scripts/one-server-model-boundary.mjs',
	'scripts/one-server-model-boundary-baseline.json',
	'scripts/one-server-model-boundary.test.mjs',
]);

const featureRows = [
	{
		id: 'server-runtime-and-local-lifecycle',
		spec: 'specs/tasks_completed/6-standalone-and-embedded-server-runtime.md',
		evidence: [
			'apps/terminay-server/test/runtime-composition.test.mjs',
			'apps/terminay-desktop/test/local-server.test.mjs',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'Runtime composition is covered locally; touch-mobile Chromium renders connected status, detects a server restart as offline without fallback, retries through connecting, and recovers through the shared profile boundary. Packaged/public host execution is operational evidence only.',
	},
	{
		id: 'server-mcp-control',
		spec: 'specs/tasks_completed/10-server-mcp-control.md',
		evidence: [
			'apps/terminay-server/test/mcp-server-owned.test.mjs',
			'scripts/mcp-renderer-free-boundary.test.mjs',
			'packages/responsive-ui/test/ui.test.mjs',
			'e2e/mcp-server.spec.ts',
			'packages/client-core/test/mcp-server-control.test.mjs',
			'e2e/shared-production-routes.spec.ts',
			'specs/decisions/evidence/task19-mobile-chromium-mcp.md',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'Server-owned MCP, renderer-free boundaries, the shared panel contract, and project-scoped Desktop control are covered; touch-mobile Chromium lists status through McpServerControlClient, receives an acknowledged start mutation, and renders a rejected retry without false success. Physical-mobile execution remains operational evidence only.',
	},
	{
		id: 'shared-responsive-shell',
		spec: 'specs/tasks_completed/16-shared-responsive-server-ui.md',
		evidence: [
			'packages/responsive-ui/test/ui.test.mjs',
			'scripts/shared-responsive-entry.test.mjs',
			'e2e/desktop-shared-route-visual.spec.ts',
			'e2e/desktop-remote-shared-shell.spec.ts',
			'e2e/shared-production-routes.spec.ts',
			'e2e/shared-responsive-shell.spec.ts',
			'specs/decisions/evidence/task19-local-remote-desktop-shell.md',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'All production-mapped shared routes render without overflow in Desktop and wide/touch-mobile Chromium. A local authenticated remote-Desktop handoff rehydrates the production shared terminal route and creates a project-scoped server terminal; hosted deployment and physical-device execution remain operational evidence only.',
	},
	{
		id: 'workspace',
		spec: 'specs/tasks_completed/5-server-owned-workspace-model.md',
		evidence: [
			'packages/server-core/test/repository.test.mjs',
			'packages/client-core/test/workspace.test.mjs',
			'e2e/workspace.spec.ts',
			'e2e/shared-workspace-route-surface.spec.ts',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'Canonical workspace commands and shared route rendering are covered; touch-mobile Chromium creates and selects a project, then creates, activates, moves, and closes a panel through named WorkspaceClient operations without narrow overflow. Physical-device execution is operational evidence only.',
	},
	{
		id: 'terminal',
		spec: 'specs/tasks_completed/8-server-terminal-service.md',
		evidence: [
			'packages/server-core/test/terminal-protocol.test.mjs',
			'scripts/terminal-panel-migration.test.mjs',
			'packages/responsive-ui/test/ui.test.mjs',
			'e2e/shared-production-routes.spec.ts',
			'specs/decisions/evidence/task19-mobile-chromium-terminal.md',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'The Desktop TerminalClient boundary and narrow terminal render model are covered; touch-mobile Chromium emulation drives create, attach, replay, input, resize, and detach. Physical soft-keyboard behavior is an operational follow-up.',
	},
	{
		id: 'activity-and-agents',
		spec: 'specs/tasks_completed/9-server-activity-and-agent-services.md',
		evidence: [
			'packages/server-core/test/agent-service.test.mjs',
			'packages/client-core/test/agent-status.test.mjs',
			'packages/responsive-ui/test/ui.test.mjs',
			'e2e/agent-status-sidebar.spec.ts',
			'e2e/terminal-signals.spec.ts',
			'e2e/terminal.spec.ts',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'Provider-safe acknowledgement, cross-project overview, signal lifecycle, and shared contracts are covered on the reproducible project surfaces.',
	},
	{
		id: 'files-and-file-viewer',
		spec: 'specs/tasks_completed/11-server-files-and-file-viewer.md',
		evidence: [
			'packages/server-core/test/file-viewer-client-e2e.test.mjs',
			'scripts/shared-client-path.test.mjs',
			'packages/responsive-ui/test/ui.test.mjs',
			'e2e/file-viewer-core.spec.ts',
			'e2e/file-viewer-conflicts-large-files.spec.ts',
			'e2e/file-viewer-modes.spec.ts',
			'e2e/shared-production-routes.spec.ts',
			'specs/decisions/evidence/task19-mobile-chromium-files.md',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'The application-protocol path plus Desktop text, binary, conflict, ranged-edit, and mode workflows are covered; touch-mobile Chromium opens through FileViewerClient, edits and saves text, rejects a conflicting save, selects bounded performant mode for large text, and keeps binary content in HEX. Physical-mobile execution remains operational evidence only.',
	},
	{
		id: 'git-and-worktrees',
		spec: 'specs/tasks_completed/12-server-git-worktrees-and-quick-push.md',
		evidence: [
			'packages/server-core/test/git-framed-client.test.mjs',
			'packages/server-core/test/git-remote-service.test.mjs',
			'packages/responsive-ui/test/ui.test.mjs',
			'e2e/file-explorer-sidebar.spec.ts',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'Git protocol, shared-panel states, and Desktop workflows are covered; touch-mobile Chromium drives the browser-relevant worktree pull, rename, Quick Push confirmation, removal, and narrow-overflow path. Physical-device execution is operational evidence only.',
	},
	{
		id: 'recordings',
		spec: 'specs/tasks_completed/13-server-recordings.md',
		evidence: [
			'packages/client-core/test/recordings.test.mjs',
			'packages/server-core/test/recordingService.test.mjs',
			'packages/responsive-ui/test/ui.test.mjs',
			'e2e/recordings.spec.ts',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'The shared client, service, and Desktop record/timeline workflow are covered; touch-mobile Chromium selects from the shared library, replays through RecordingsClient, deletes, refreshes to empty state, and remains narrow-layout safe. Physical-device playback is operational evidence only.',
	},
	{
		id: 'settings-and-macros',
		spec: 'specs/tasks_completed/14-server-settings-secrets-and-macros.md',
		evidence: [
			'packages/server-core/test/macro-protocol.test.mjs',
			'scripts/task14-settings-client-path.test.mjs',
			'packages/responsive-ui/test/ui.test.mjs',
			'e2e/settings.spec.ts',
			'e2e/macros.spec.ts',
			'e2e/shared-production-routes.spec.ts',
			'specs/decisions/evidence/task19-mobile-chromium-settings.md',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'Secrets stay privileged and Desktop persistence/race workflows are covered; touch-mobile Chromium searches and navigates settings, saves/resets terminal settings, and creates, edits, deletes, and resets macros through server-acknowledged MacroClient state. Physical-device execution is operational evidence only.',
	},
	{
		id: 'ai-and-dictation',
		spec: 'specs/tasks_completed/15-server-ai-and-dictation.md',
		evidence: [
			'packages/server-core/test/ai-protocol.test.mjs',
			'packages/client-core/test/dictation.test.mjs',
			'scripts/task15-renderer-ai-path.test.mjs',
			'packages/responsive-ui/test/ui.test.mjs',
			'e2e/ai-tab-metadata.spec.ts',
			'e2e/mobile-dictation.spec.ts',
			'specs/decisions/evidence/task19-mobile-chromium-dictation.md',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'Touch-mobile Chromium renders immutable-target capture state, provider failure recovery, submit, and cancel through DictationCaptureClient and a named upload boundary without horizontal overflow. Real microphone capture, provider execution, browser permission prompts, soft-keyboard behavior, and physical devices are operational evidence only.',
	},
	{
		id: 'connections-and-hosts',
		spec: 'specs/tasks_completed/18-connection-menu-and-web-host.md',
		evidence: [
			'packages/responsive-ui/test/ui.test.mjs',
			'apps/terminay-desktop/test/connection-host.test.mjs',
			'apps/terminay-web/test/connection-host.test.mjs',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'Host-neutral menu/profile contracts and deterministic multi-window Desktop behavior are covered; deployed manager and real hosted pairing remain external blockers.',
	},
	{
		id: 'pairing-and-reconnect',
		spec: 'specs/tasks_completed/17-full-webrtc-server-connections.md',
		evidence: [
			'packages/server-core/test/remote-pairing.test.mjs',
			'packages/server-core/test/remote-reconnect.test.mjs',
			'scripts/task19-migration-reconnect.test.mjs',
		],
		status: {
			'local-desktop': 'contract',
			'remote-desktop': 'contract',
			'wide-web': 'contract',
			'mobile-web': 'contract',
		},
		gap: 'Deterministic pairing, reconnect, migration continuity, and rendered connection paths are project-covered. External hosted and physical-host execution is an operational follow-up.',
	},
];

export const TASK19_FEATURE_MATRIX = Object.freeze(
	featureRows.map((feature) =>
		Object.freeze({
			...feature,
			status: Object.freeze({ ...feature.status }),
			evidence: Object.freeze([...feature.evidence]),
		}),
	),
);

export function summarizeTask19FeatureMatrix(matrix = TASK19_FEATURE_MATRIX) {
	const cells = matrix.flatMap((feature) =>
		TASK19_SURFACES.map((surface) => ({
			feature: feature.id,
			surface,
			status: feature.status[surface],
		})),
	);
	return Object.freeze({
		featureCount: matrix.length,
		surfaceCount: TASK19_SURFACES.length,
		cellCount: cells.length,
		contractCells: cells.filter((cell) => cell.status === 'contract').length,
		partialCells: cells.filter((cell) => cell.status === 'partial').length,
		openCells: cells.filter((cell) => cell.status === 'open').length,
		completeCells: cells.filter((cell) => cell.status === 'complete').length,
	});
}

async function accessTaskSpec(root, spec) {
	const configuredPath = join(root, spec);
	try {
		await access(configuredPath);
		return;
	} catch (error) {
		if (error?.code !== 'ENOENT' || !spec.startsWith('specs/tasks/'))
			throw error;
	}
	await access(join(root, 'specs/tasks_completed', basename(spec)));
}

/**
 * Validate the matrix's evidence completeness. Every surface/feature cell is
 * explicit and inherits its row's nonempty parity semantics plus resolved
 * canonical spec and local evidence files.
 */
export async function validateTask19FeatureMatrix(
	root = process.cwd(),
	matrix = TASK19_FEATURE_MATRIX,
) {
	if (new Set(TASK19_SURFACES).size !== TASK19_SURFACES.length)
		throw new Error('Task 19 surfaces must be unique');
	if (!Array.isArray(matrix) || matrix.length === 0)
		throw new Error('Task 19 matrix must contain at least one feature');
	for (const evidence of TASK19_ARCHITECTURE_EVIDENCE)
		await access(join(root, evidence));
	const featureIds = new Set();
	for (const feature of matrix) {
		if (featureIds.has(feature.id))
			throw new Error(`duplicate Task 19 feature: ${feature.id}`);
		featureIds.add(feature.id);
		if (
			typeof feature.spec !== 'string' ||
			feature.spec.trim().length === 0 ||
			typeof feature.gap !== 'string' ||
			feature.gap.trim().length === 0 ||
			!Array.isArray(feature.evidence) ||
			feature.evidence.length === 0 ||
			feature.evidence.some(
				(evidence) =>
					typeof evidence !== 'string' || evidence.trim().length === 0,
			)
		) {
			throw new Error(`incomplete Task 19 feature row: ${feature.id}`);
		}
		await accessTaskSpec(root, feature.spec);
		for (const evidence of feature.evidence) await access(join(root, evidence));
		for (const surface of TASK19_SURFACES) {
			if (!['contract', 'partial', 'open'].includes(feature.status[surface])) {
				throw new Error(`invalid Task 19 status for ${feature.id}/${surface}`);
			}
		}
	}
	const summary = summarizeTask19FeatureMatrix(matrix);
	return Object.freeze({
		architectureEvidence: TASK19_ARCHITECTURE_EVIDENCE,
		features: matrix,
		surfaces: TASK19_SURFACES,
		summary,
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	console.log(JSON.stringify(await validateTask19FeatureMatrix(), null, 2));
}
