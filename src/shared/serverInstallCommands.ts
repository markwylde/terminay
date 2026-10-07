/**
 * The commands Add connection shows a person who has no server yet.
 *
 * Everything here is assembled from constants and a version that has passed
 * the project's version grammar. Nothing from a server, a pairing URL, or
 * anything a person typed reaches the text they are asked to copy.
 */

const IMAGE = 'markwylde/terminay';
const CONTAINER = 'terminay';
const VOLUME = 'terminay-data:/var/lib/terminay';

const STABLE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const BETA = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta\.[1-9]\d*$/u;
/** What an unversioned development build reports. */
const DEVELOPMENT = '0.0.0';

export const INSTALLATION_GUIDE_URL = 'https://terminay.com/docs/installation';
export const MANUAL_INSTALL_URL =
	'https://terminay.com/docs/installation#manual-install';
export const PUBLIC_HOST_PLACEHOLDER = "<this machine's address>";

export type ServerInstallChannel = 'stable' | 'beta' | 'unknown';

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

/** Stable is `X.Y.Z`, beta is `X.Y.Z-beta.N`. Anything else names no version. */
export function serverInstallChannel(version: unknown): ServerInstallChannel {
	if (typeof version !== 'string' || version === DEVELOPMENT) return 'unknown';
	if (STABLE.test(version)) return 'stable';
	if (BETA.test(version)) return 'beta';
	return 'unknown';
}

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
			start: `docker run -d --name ${CONTAINER} -v ${VOLUME} ${image}`,
			pair: `docker exec -it ${CONTAINER} terminay daemon qr-code`,
		}),
		linux: Object.freeze({
			// The CLI is published for releases only; `main` is the installer's
			// name for the channel a beta is built from.
			start:
				channel === 'beta'
					? 'sudo npx terminay daemon install main'
					: 'sudo npx terminay daemon install',
			pair: 'sudo npx terminay daemon qr-code',
		}),
		dockerPublic: `docker run -d --name ${CONTAINER} -v ${VOLUME} -p 8443:8443 -p 51000-51015:51000-51015/udp -e TERMINAY_PUBLIC_HOST=${PUBLIC_HOST_PLACEHOLDER} ${image}`,
		dockerHostNetwork: `docker run -d --name ${CONTAINER} --network host -v ${VOLUME} ${image}`,
	});
}
