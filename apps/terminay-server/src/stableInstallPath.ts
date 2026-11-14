import { lstatSync, realpathSync } from 'node:fs';
import { join, parse, sep } from 'node:path';

/**
 * The path a standalone installation keeps valid across upgrades (ADR-0119).
 *
 * An installation keeps each release in `<prefix>/versions/<release>/` and
 * points `<prefix>/current` at the one it runs. Node resolves the executable
 * and module URLs through that link, so a path the server writes somewhere
 * that outlives it — an agent's MCP registration — would name one release and
 * break once that release is pruned. When `path` lies inside the release that
 * `<prefix>/current` resolves to, this returns the same file through
 * `<prefix>/current`. Any other path, including every path Desktop or a
 * development checkout runs from, is returned unchanged.
 */
export function stableInstallPath(path: string): string {
	let real: string;
	try {
		real = realpathSync(path);
	} catch {
		return path;
	}
	const { root } = parse(real);
	const segments = real.slice(root.length).split(sep);
	// The innermost `versions/<release>` wins, so a prefix that itself sits
	// under a directory called `versions` still resolves to its own pointer.
	for (let index = segments.length - 2; index >= 1; index -= 1) {
		const name = segments[index + 1];
		if (segments[index] !== 'versions' || !name) continue;
		const prefix = root + segments.slice(0, index).join(sep);
		const release = join(prefix, 'versions', name);
		const current = join(prefix, 'current');
		try {
			if (!lstatSync(current).isSymbolicLink()) continue;
			if (realpathSync(current) !== realpathSync(release)) continue;
		} catch {
			continue;
		}
		return join(current, ...segments.slice(index + 2));
	}
	return path;
}
