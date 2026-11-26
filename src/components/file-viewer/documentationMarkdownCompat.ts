const VOID_ELEMENTS =
	'area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr';

// `[^>]*?` also matches quoted attribute values; a `>` inside quotes is rare
// enough in documentation that the simple form is the right trade-off.
const OPEN_VOID_TAG = new RegExp(
	`<(${VOID_ELEMENTS})(\\s[^>]*?)?\\s*(?<!/)>`,
	'giu',
);
const HAS_VOID_TAG = new RegExp(`<(?:${VOID_ELEMENTS})\\b`, 'iu');
// CommonMark autolinks: `<scheme:anything-but-space-or-angle>` and `<user@host>`.
const URI_AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/gu;
const EMAIL_AUTOLINK =
	/<([A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/gu;
const HAS_AUTOLINK =
	/<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;

const escapeLinkText = (text: string) => text.replace(/[\\[\]*_`]/gu, '\\$&');

const toInlineLink = (text: string, url: string) =>
	`[${escapeLinkText(text)}](<${url}>)`;

function rewriteProse(part: string): string {
	return part
		.replace(
			OPEN_VOID_TAG,
			(_, name: string, attributes = '') =>
				`<${name}${attributes.trimEnd()} />`,
		)
		.replace(URI_AUTOLINK, (_, url: string) => toInlineLink(url, url))
		.replace(EMAIL_AUTOLINK, (_, email: string) =>
			toInlineLink(email, `mailto:${email}`),
		);
}

/**
 * The editor parses Markdown as MDX, where some plain GitHub-style Markdown is
 * invalid JSX and fails the whole document. Outside code:
 *
 * - an HTML void element such as `<img src="a.svg">` is an unclosed JSX tag,
 *   so self-close it;
 * - an autolink such as `<http://localhost:8080>` or `<me@example.com>` is an
 *   invalid JSX tag name, so rewrite it as the equivalent inline link. The
 *   serializer writes a link whose text is its URL back as an autolink.
 */
export function prepareMarkdownForMdx(markdown: string): string {
	if (!HAS_VOID_TAG.test(markdown) && !HAS_AUTOLINK.test(markdown))
		return markdown;
	let fence: string | undefined;
	return markdown
		.split('\n')
		.map((line) => {
			const marker = FENCE.exec(line)?.[1];
			if (fence !== undefined) {
				if (
					marker !== undefined &&
					marker[0] === fence[0] &&
					marker.length >= fence.length &&
					line.trim() === marker
				)
					fence = undefined;
				return line;
			}
			if (marker !== undefined) {
				fence = marker;
				return line;
			}
			return line
				.split(/(`+[^`]*`+)/u)
				.map((part, index) => (index % 2 === 1 ? part : rewriteProse(part)))
				.join('');
		})
		.join('\n');
}

/**
 * A single newline inside a Markdown paragraph is a soft line break: it renders
 * as a space, and only a blank line starts a new paragraph. Collapse it to the
 * space it stands for.
 *
 * This runs on an mdast `text` node's value, never on raw source, so the parser
 * has already decided what is prose: code, tables, hard breaks, and list and
 * quote markers are other node types and never reach here. Surrounding spaces
 * and tabs go with the newline, because the wrap itself is the only thing the
 * author meant by them.
 */
export function collapseSoftLineBreaks(text: string): string {
	return text.replace(/[ \t]*\n[ \t]*/gu, ' ');
}
