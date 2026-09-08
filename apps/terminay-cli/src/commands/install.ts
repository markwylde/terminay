import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname } from 'node:path';
import {
	assertRootForSystemScope,
	prepareDataRoot,
	selectRunAs,
	selectScope,
} from '../account.js';
import { defaultDirectOrigin } from '../address.js';
import type { DaemonOptions, InstallScope } from '../args.js';
import {
	discardDownloads,
	downloadAsset,
	downloadBytes,
	downloadText,
} from '../download.js';
import { waitForReady } from '../health.js';
import {
	activate,
	installArchive,
	installedVersions,
	retain,
} from '../install.js';
import {
	type InstallLayout,
	type InstallRecord,
	installLayout,
	writeInstallRecord,
} from '../layout.js';
import { hostArchitecture } from '../platform.js';
import { defaultStreams, type PromptStreams } from '../prompt.js';
import { type ResolvedRef, resolveRef } from '../resolve.js';
import { buildFromSource } from '../source.js';
import { createSystemd } from '../systemd.js';
import {
	parseEnvironmentFile,
	renderEnvironmentFile,
	renderUnit,
} from '../unit.js';
import { verifyArchive } from '../verify.js';

/**
 * `daemon install` — one command from a clean Linux box to a running,
 * exposed, pairable server.
 *
 * The order matters: resolve, download, verify, unpack, verify again against
 * the manifest, and only then touch systemd. Everything that can fail on the
 * operator's behalf fails before the machine has been changed.
 */

export const DEFAULT_PORT = 8443;
export const DEFAULT_HEALTH_PORT = 8444;
export const DEFAULT_HOSTED_DOMAIN = 'terminay.com';
export const DEFAULT_EXPOSE = 'hosted,direct';

export interface InstallDependencies {
	readonly home?: string;
	readonly streams?: PromptStreams;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly write?: (line: string) => void;
	readonly repository?: string;
	readonly apiBase?: string;
	readonly webBase?: string;
	readonly architecture?: 'x64' | 'arm64';
	readonly serverId?: string;
	readonly uid?: number;
	readonly readinessTimeoutMs?: number;
	/**
	 * Verify against this key instead of the embedded one. A test seam for
	 * fixtures signed by a throwaway key; it still demands a valid signature,
	 * so it relaxes nothing. The `terminay` binary never passes it.
	 */
	readonly releasePublicKeyPem?: string;
	/**
	 * Install an archive already on this disk instead of resolving a release.
	 * It is treated exactly as a source build is — no publisher, so no
	 * signature, and the manifest checked as always — which is what the
	 * systemd container smoke installs. The `terminay` binary never passes it.
	 */
	readonly localArchivePath?: string;
}

export interface InstallResult {
	readonly version: string;
	readonly channel: string;
	readonly revision: string;
	readonly directOrigin?: string;
	readonly ready: boolean;
}

/** Fetch and verify an archive, or build one when the ref is a source ref. */
async function stageArchive(
	resolved: ResolvedRef,
	layout: InstallLayout,
	write: (line: string) => void,
	publicKeyPem?: string,
): Promise<{ readonly archivePath: string; readonly signed: boolean }> {
	if (resolved.channel === 'source') {
		write(
			`Building ${resolved.sourceRef ?? resolved.version} from source. This takes a while.`,
		);
		const built = await buildFromSource({
			ref: resolved.sourceRef ?? resolved.version,
			...(resolved.revision === undefined
				? {}
				: { revision: resolved.revision }),
			destination: layout.prefix,
			write,
		});
		return { archivePath: built.archivePath, signed: false };
	}
	const assets = resolved.assets;
	if (assets === undefined)
		throw new Error('the resolved release names no archive to download');
	write(
		`Downloading ${resolved.channel === 'tag' ? resolved.version : `${resolved.channel} channel`} …`,
	);
	const asset = await downloadAsset(assets.archive, layout.prefix);
	const [sidecar, signature] = await Promise.all([
		downloadText(assets.sha256),
		downloadBytes(assets.signature),
	]);
	await verifyArchive({
		archivePath: asset.path,
		sidecar,
		signature,
		digest: asset.sha256,
		...(publicKeyPem === undefined ? {} : { publicKeyPem }),
	});
	write('Checksum and signature verified.');
	return { archivePath: asset.path, signed: true };
}

export async function runInstall(
	ref: string | undefined,
	options: DaemonOptions,
	dependencies: InstallDependencies = {},
): Promise<InstallResult> {
	const home = dependencies.home ?? homedir();
	const streams = dependencies.streams ?? defaultStreams();
	const write =
		dependencies.write ?? ((line: string) => process.stdout.write(`${line}\n`));

	const scope: InstallScope = await selectScope({
		...(options.scope === undefined ? {} : { requested: options.scope }),
		streams,
	});
	if (scope === 'system') {
		assertRootForSystemScope(
			`npx terminay daemon install${ref === undefined ? '' : ` ${ref}`} --system`,
			dependencies.uid ?? process.getuid?.(),
		);
	}
	const selection = await selectRunAs({
		scope,
		...(options.runAs === undefined ? {} : { requested: options.runAs }),
		streams,
	});

	const layout = installLayout(scope, home);
	const architecture = dependencies.architecture ?? hostArchitecture();
	const resolved: ResolvedRef =
		dependencies.localArchivePath === undefined
			? await resolveRef(ref, {
					architecture,
					...(dependencies.repository === undefined
						? {}
						: { repository: dependencies.repository }),
					...(dependencies.apiBase === undefined
						? {}
						: { apiBase: dependencies.apiBase }),
					...(dependencies.webBase === undefined
						? {}
						: { webBase: dependencies.webBase }),
				})
			: Object.freeze({ channel: 'source' as const, version: 'local' });

	await mkdir(layout.prefix, { recursive: true, mode: 0o755 });
	const staged =
		dependencies.localArchivePath === undefined
			? await stageArchive(
					resolved,
					layout,
					write,
					dependencies.releasePublicKeyPem,
				)
			: { archivePath: dependencies.localArchivePath, signed: false };
	const installed = await installArchive({
		layout,
		archivePath: staged.archivePath,
		channel: resolved.channel,
		expected: {
			channel: resolved.channel,
			architecture,
			...(resolved.channel === 'tag' ? { version: resolved.version } : {}),
			...(resolved.revision === undefined
				? {}
				: { revision: resolved.revision }),
		},
	});
	await discardDownloads(layout.prefix);

	const port = options.port ?? DEFAULT_PORT;
	const dataRoot = layout.defaultDataRoot;
	await prepareDataRoot(dataRoot, selection.runAs, scope);

	// A reinstall keeps the identity paired devices already know.
	const existing = parseEnvironmentFile(
		await readFile(layout.environmentFile, 'utf8').catch(() => ''),
	);
	const serverId =
		existing.TERMINAY_SERVER_ID ?? dependencies.serverId ?? hostname();

	const expose = options.expose ?? DEFAULT_EXPOSE;
	const wantsDirect = expose.split(',').includes('direct');
	const directOrigin = wantsDirect
		? (options.directOrigin ?? (await defaultDirectOrigin(port)))
		: options.directOrigin;
	if (wantsDirect && directOrigin === undefined) {
		throw new Error(
			'direct exposure needs an origin devices can reach, and this machine has no routable address to derive one from. Pass --direct-origin https://<host>:<port>.',
		);
	}

	await mkdir(dirname(layout.environmentFile), {
		recursive: true,
		mode: 0o755,
	});
	await writeFile(
		layout.environmentFile,
		renderEnvironmentFile({
			serverId,
			dataRoot,
			projectRoot: options.projectRoot ?? selection.home,
			port,
			healthPort: DEFAULT_HEALTH_PORT,
			expose,
			hostedDomain: options.hostedDomain ?? DEFAULT_HOSTED_DOMAIN,
			...(directOrigin === undefined ? {} : { directOrigin }),
			uiBundle: `${layout.currentLink}/ui`,
		}),
		{ mode: 0o640 },
	);
	// Readable only by the account the service runs as.
	await chmod(layout.environmentFile, 0o640);

	await activate(layout, installed.name);

	await mkdir(dirname(layout.unitPath), { recursive: true, mode: 0o755 });
	await writeFile(
		layout.unitPath,
		renderUnit({
			layout,
			runAs: selection.runAs,
			workingDirectory: options.projectRoot ?? selection.home,
		}),
		{ mode: 0o644 },
	);

	const systemd = createSystemd({
		scope,
		...(dependencies.env === undefined ? {} : { env: dependencies.env }),
	});
	await systemd.daemonReload();
	if (scope === 'user') await systemd.enableLinger(selection.runAs);
	await systemd.enableNow();

	const ready =
		(await waitForReady(
			DEFAULT_HEALTH_PORT,
			dependencies.readinessTimeoutMs,
		)) !== undefined;

	const record: InstallRecord = {
		schemaVersion: 1,
		scope,
		channel: resolved.channel,
		version: installed.manifest.version,
		revision: installed.manifest.revision,
		...(resolved.publishedAt === undefined
			? {}
			: { publishedAt: resolved.publishedAt }),
		runAs: selection.runAs,
		dataRoot,
		projectRoot: options.projectRoot ?? selection.home,
		port,
		healthPort: DEFAULT_HEALTH_PORT,
		expose,
		hostedDomain: options.hostedDomain ?? DEFAULT_HOSTED_DOMAIN,
		...(directOrigin === undefined ? {} : { directOrigin }),
		installedAt: new Date().toISOString(),
	};
	await writeInstallRecord(layout, record);
	await retain(layout, [
		installed.name,
		...(await installedVersions(layout))
			.filter((name) => name !== installed.name)
			.slice(-1),
	]);

	write('');
	write(
		`Terminay Server ${installed.manifest.version} is installed and ${ready ? 'running' : 'starting'}.`,
	);
	write(`  scope        ${scope}`);
	write(`  runs as      ${selection.runAs}`);
	write(`  channel      ${resolved.channel}`);
	write(`  data root    ${dataRoot}`);
	write(`  exposure     ${expose}`);
	if (directOrigin !== undefined) {
		write(`  direct URL   ${directOrigin}`);
		write('');
		write(
			'If devices cannot reach that address — the machine is behind NAT, or has a',
		);
		write('DNS name — reinstall with --direct-origin https://<host>:<port>.');
	}
	if (!ready) {
		write('');
		write('The server has not reported ready yet. Recent log lines:');
		write(await systemd.journal(20));
	}
	write('');
	write('Pair a device with:  npx terminay daemon qr-code');

	return Object.freeze({
		version: installed.manifest.version,
		channel: resolved.channel,
		revision: installed.manifest.revision,
		...(directOrigin === undefined ? {} : { directOrigin }),
		ready,
	});
}
