/** Structural equality of two JSON values. */
export function sameJsonValue(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (
		left === null ||
		right === null ||
		typeof left !== 'object' ||
		typeof right !== 'object'
	)
		return false;
	if (Array.isArray(left)) {
		if (!Array.isArray(right) || left.length !== right.length) return false;
		for (let index = 0; index < left.length; index += 1)
			if (!sameJsonValue(left[index], right[index])) return false;
		return true;
	}
	if (Array.isArray(right)) return false;
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const keys = Object.keys(leftRecord);
	if (keys.length !== Object.keys(rightRecord).length) return false;
	for (const key of keys) {
		if (!Object.hasOwn(rightRecord, key)) return false;
		if (!sameJsonValue(leftRecord[key], rightRecord[key])) return false;
	}
	return true;
}
