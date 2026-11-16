/** Quoting a chat message into the composer as a Markdown blockquote. */

/** Longest quoted text, in Unicode code points, before it is cut. */
export const QUOTE_LIMIT = 2000;

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;

function isBlank(line: string): boolean {
	return line.trim() === '';
}

/** Cuts text over the limit at a line break in the second half where there is one, closing a cut-open fence. */
function bound(lines: string[]): string[] {
	const points = Array.from(lines.join('\n'));
	if (points.length <= QUOTE_LIMIT) return lines;
	let kept = points.slice(0, QUOTE_LIMIT);
	const lastBreak = kept.lastIndexOf('\n');
	if (lastBreak >= QUOTE_LIMIT / 2) kept = kept.slice(0, lastBreak);
	const cut = kept.join('').split('\n');
	// An open fence is closed by the same marker, at least as long, with nothing after it.
	let open: { indent: string; marker: string } | undefined;
	for (const line of cut) {
		const match = FENCE.exec(line);
		if (!match) continue;
		const [, indent = '', marker = '', rest = ''] = match;
		if (open === undefined) open = { indent, marker };
		else if (
			marker[0] === open.marker[0] &&
			marker.length >= open.marker.length &&
			rest.trim() === ''
		)
			open = undefined;
	}
	while (cut.length && isBlank(cut[cut.length - 1]!)) cut.pop();
	// The closing fence keeps the opening's indentation, so a fence in a list stays in it.
	if (open !== undefined) cut.push(open.indent + open.marker);
	cut.push('', '…');
	return cut;
}

/**
 * Formats text as a Markdown blockquote followed by a blank line, or '' when
 * there is nothing to quote.
 */
export function quoteMessage(text: string): string {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	while (lines.length && isBlank(lines[0]!)) lines.shift();
	while (lines.length && isBlank(lines[lines.length - 1]!)) lines.pop();
	if (!lines.length) return '';
	return `${bound(lines)
		.map((line) => (line === '' ? '>' : `> ${line}`))
		.join('\n')}\n\n`;
}

/** Appends a quote to a draft, separated by one blank line, never changing the draft's own text. */
export function appendQuote(draft: string, quote: string): string {
	if (!draft) return quote;
	if (draft.endsWith('\n\n')) return draft + quote;
	if (draft.endsWith('\n')) return `${draft}\n${quote}`;
	return `${draft}\n\n${quote}`;
}
