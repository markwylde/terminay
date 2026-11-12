/**
 * The commands Add connection shows a person who has no server yet.
 *
 * Everything here is assembled from constants and a version that has passed
 * the project's version grammar. Nothing from a server, a pairing URL, or
 * anything a person typed reaches the text they are asked to copy.
 */

const IMAGE = 'markwylde/terminay';
const CONTAINER = 'terminay';
// The data root is the server's identity; the home directory is the person's
// projects and shell. Both outlive the container.
const VOLUMES =
	'-v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay';

const STABLE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
// A Nightly or Canary build: `X.Y.Z-main.<commit count>.<track>` (ADR-0110).
const PRERELEASE =
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-main\.[1-9]\d*\.(nightly|canary)$/u;
/** What an unversioned development build reports. */
const DEVELOPMENT = '0.0.0';

export const INSTALLATION_GUIDE_URL = 'https://terminay.com/docs/installation';
export const MANUAL_INSTALL_URL =
	'https://terminay.com/docs/installation#manual-install';
export const PUBLIC_HOST_PLACEHOLDER = "<this machine's address>";

export type ServerInstallChannel = 'stable' | 'nightly' | 'canary' | 'unknown';

export type ServerInstallCommands = Readonly<{
	channel: ServerInstallChannel;
	/** The official image at the tag that matches this client. */
	image: string;
	docker: Readonly<{ start: string; pair: string }>;
	linux: Readonly<{ start: string; pair: string }>;
	/** Docker, reachable from browsers and phones on the network. */
	dockerPublic: string;
	/** Docker on a Linux host, sharing the machine's network. */
	dockerHostNetwork: string;
}>;

/**
 * Stable is `X.Y.Z`; Nightly and Canary are `X.Y.Z-main.N.nightly` and
 * `X.Y.Z-main.N.canary`. Anything else, an old `-beta.N` build included,
 * names no version.
 */
export function serverInstallChannel(version: unknown): ServerInstallChannel {
	if (typeof version !== 'string' || version === DEVELOPMENT) return 'unknown';
	if (STABLE.test(version)) return 'stable';
	const track = PRERELEASE.exec(version)?.[1];
	if (track === 'nightly' || track === 'canary') return track;
	return 'unknown';
}

/**
 * The installer reference that follows a client's track: the newest tag for
 * Stable, the rolling `main` channel for Nightly, `canary` for Canary.
 */
const LINUX_INSTALL: Readonly<Record<ServerInstallChannel, string>> =
	Object.freeze({
		stable: 'sudo npx terminay daemon install',
		nightly: 'sudo npx terminay daemon install main',
		canary: 'sudo npx terminay daemon install canary',
		unknown: 'sudo npx terminay daemon install',
	});

export function serverInstallCommands(
	input: Readonly<{ version?: unknown }> = {},
): ServerInstallCommands {
	const channel = serverInstallChannel(input.version);
	// An unknown version yields the bare name, which is the newest release.
	const image = channel === 'unknown' ? IMAGE : `${IMAGE}:${input.version}`;
	return Object.freeze({
		channel,
		image,
		docker: Object.freeze({
			start: `docker run -d --name ${CONTAINER} ${VOLUMES} ${image}`,
			pair: `docker exec -it ${CONTAINER} terminay daemon qr-code`,
		}),
		linux: Object.freeze({
			// The CLI is published for releases only; `main` is the installer's
			// name for the Nightly's channel and `canary` for the Canary's.
			start: LINUX_INSTALL[channel],
			pair: 'sudo npx terminay daemon qr-code',
		}),
		dockerPublic: `docker run -d --name ${CONTAINER} ${VOLUMES} -p 8443:8443 -p 51000-51015:51000-51015/udp -e TERMINAY_PUBLIC_HOST=${PUBLIC_HOST_PLACEHOLDER} ${image}`,
		dockerHostNetwork: `docker run -d --name ${CONTAINER} --network host ${VOLUMES} ${image}`,
	});
}
