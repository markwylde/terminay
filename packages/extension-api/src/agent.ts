/**
 * Returns display text bounded to `maximum` UTF-16 code units, or `undefined`
 * for anything that is not a non-empty string. A cut never splits a surrogate
 * pair. Use it for titles, models, and messages; never for identity values,
 * which must be rejected rather than shortened.
 */
export function boundedAgentText(
	value: unknown,
	maximum: number,
): string | undefined {
	if (typeof value !== 'string' || value.length === 0) return undefined;
	if (value.length <= maximum) return value;
	let end = maximum;
	const last = value.charCodeAt(end - 1);
	if (last >= 0xd800 && last <= 0xdbff) end -= 1;
	return end > 0 ? value.slice(0, end) : undefined;
}
