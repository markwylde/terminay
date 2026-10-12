/**
 * The image a container was started from, and the one a recreate moves to.
 *
 * A container remembers the reference it was created with, and that reference
 * says what the operator meant. `terminay:latest`, `terminay:main`, and a bare
 * `terminay` name something that moves, so the newer image is the same
 * reference pulled again. `terminay:5.1.1` names one release, so the newer
 * image is the same repository at the newer release's tag, written the way the
 * operator wrote theirs. `terminay@sha256:…` names exactly one image and can
 * never mean another, so it is refused: replacing it would undo the pin.
 *
 * Nothing here talks to a registry or a daemon; it is all string work, so the
 * check and the recreate cannot disagree about what a reference means.
 */

export type ImageReference =
	| {
			readonly kind: 'moving';
			readonly repository: string;
			/** Absent for a bare name, which a daemon reads as `latest`. */
			readonly tag?: string;
	  }
	| {
			readonly kind: 'version';
			readonly repository: string;
			readonly tag: string;
			/** The tag without its `v`, for ordering against a release. */
			readonly version: string;
			readonly prefixed: boolean;
	  }
	| {
			readonly kind: 'pinned';
			readonly reason: string;
	  };

const VERSION_TAG = /^(v?)(\d+\.\d+\.\d+(?:-beta\.[1-9]\d*)?)$/u;
const IMAGE_ID = /^(?:sha256:)?[a-f0-9]{64}$/u;

export function parseImageReference(reference: string): ImageReference {
	const raw = reference.trim();
	if (raw.length === 0) {
		return Object.freeze({
			kind: 'pinned',
			reason: 'this container does not record the image it was created from.',
		});
	}
	if (IMAGE_ID.test(raw) || raw.startsWith('sha256:')) {
		return Object.freeze({
			kind: 'pinned',
			reason:
				'this container was created from an image id rather than a name, so there is no reference to pull a newer image from. Create it from a name such as an image tagged `latest` to use recreate.',
		});
	}
	if (raw.includes('@')) {
		return Object.freeze({
			kind: 'pinned',
			reason: `this container is pinned to one image by digest (${raw.slice(0, 96)}), and recreating it on another would undo that. Pull the image you want and recreate the container yourself, or upgrade in place.`,
		});
	}
	// A colon before the last slash belongs to a registry's port, not a tag.
	const slash = raw.lastIndexOf('/');
	const colon = raw.lastIndexOf(':');
	if (colon <= slash) return Object.freeze({ kind: 'moving', repository: raw });
	const repository = raw.slice(0, colon);
	const tag = raw.slice(colon + 1);
	const version = VERSION_TAG.exec(tag);
	if (version === null)
		return Object.freeze({ kind: 'moving', repository, tag });
	return Object.freeze({
		kind: 'version',
		repository,
		tag,
		version: version[2] as string,
		prefixed: version[1] === 'v',
	});
}

export interface TargetImage {
	/** What the replacement container is created from. */
	readonly reference: string;
	readonly repository: string;
	/** What to pull. A bare name pulls `latest`, never every tag. */
	readonly tag: string;
}

export class ImageReferenceError extends Error {}

/**
 * The reference a recreate moves to.
 *
 * `availableVersion` is the newest release on the installed channel, and is
 * needed only where the reference names a release.
 */
export function resolveTargetImage(
	reference: string,
	availableVersion?: string,
): TargetImage {
	const parsed = parseImageReference(reference);
	if (parsed.kind === 'pinned') throw new ImageReferenceError(parsed.reason);
	if (parsed.kind === 'moving') {
		return Object.freeze({
			reference: reference.trim(),
			repository: parsed.repository,
			tag: parsed.tag ?? 'latest',
		});
	}
	if (availableVersion === undefined) {
		throw new ImageReferenceError(
			`this container runs the image tagged ${parsed.tag}, and the release to move to is not known.`,
		);
	}
	const bare = availableVersion.replace(/^v/u, '');
	if (!VERSION_TAG.test(bare)) {
		throw new ImageReferenceError(
			`${availableVersion} is not a release version an image is tagged with.`,
		);
	}
	const tag = `${parsed.prefixed ? 'v' : ''}${bare}`;
	return Object.freeze({
		reference: `${parsed.repository}:${tag}`,
		repository: parsed.repository,
		tag,
	});
}
