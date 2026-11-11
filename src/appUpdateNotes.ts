import MarkdownIt from 'markdown-it';

// Release notes arrive over the network, so they are rendered as untrusted
// Markdown: raw HTML is escaped (`html: false`), markdown-it's link validator
// rejects script-capable URL schemes, and images are rendered as their alt
// text so opening the dialog never loads a remote resource.
const releaseNotesMarkdown = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: true,
}).disable('image');

export function renderReleaseNotesHtml(markdown: string): string {
	return releaseNotesMarkdown.render(markdown);
}

/** Only web links leave the dialog, and only through the host's browser. */
export function releaseNoteLinkTarget(href: string | null): string | null {
	if (href === null) return null;
	return /^https?:\/\//i.test(href) ? href : null;
}

/**
 * The track a Nightly or Canary version was built for (`X.Y.Z-main.N.nightly`,
 * `X.Y.Z-main.N.canary`, ADR-0109), named in the What's new title. A stable
 * release, offered on any channel, names no track.
 */
export function releaseTrackLabel(version: string | null): string | null {
	const track = /-main\.[1-9]\d*\.(nightly|canary)$/u.exec(version ?? '')?.[1];
	if (track === 'nightly') return 'Nightly build';
	if (track === 'canary') return 'Canary build';
	return null;
}
