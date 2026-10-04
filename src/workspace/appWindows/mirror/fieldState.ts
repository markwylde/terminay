/**
 * What a person has put into a view: the values of its form controls and where
 * it is scrolled to (ADR-0039).
 *
 * A mirror is a picture of a view, not a running copy, so when control of a
 * terminal moves to a client that was mirroring, a new view starts there. What
 * the person had typed goes with it: the mirror can see it, and it is put into
 * the new view. What a view keeps only in its own script cannot be seen from
 * outside it, so it is the view's to rebuild from what it is given.
 *
 * This file runs in two sandboxes: the replica collects, and the view's loader
 * applies. A control is found again by its id, else its name, else its place
 * among the controls of the document.
 */

export interface FieldValue {
	/** How the control is found again; see `fieldKeys`. */
	readonly key: string;
	readonly value?: string;
	readonly checked?: boolean;
}

export interface FieldState {
	readonly fields: readonly FieldValue[];
	readonly scrollX: number;
	readonly scrollY: number;
}

/** No more controls than this are carried, and no more text than this in all. */
export const MAX_FIELDS = 500;
export const MAX_FIELD_CHARS = 256 * 1024;

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const SKIPPED_INPUTS = new Set(['password', 'file', 'hidden', 'submit', 'button', 'reset', 'image']);

/** Each control worth carrying, with the key it is found by. */
function fieldKeys(doc: Document): [string, Control][] {
	const seen = new Map<string, number>();
	const keyed: [string, Control][] = [];
	let ordinal = 0;
	for (const element of Array.from(doc.querySelectorAll('input, textarea, select'))) {
		const control = element as Control;
		ordinal += 1;
		// A password is never sent to a mirror, so there is none to carry.
		if (control instanceof HTMLInputElement && SKIPPED_INPUTS.has(control.type)) continue;
		const base =
			control.id !== ''
				? `id:${control.id}`
				: control.name !== ''
					? `name:${control.name}`
					: `nth:${ordinal}`;
		// Radio buttons share a name; controls can share an id by mistake.
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		keyed.push([count === 0 ? base : `${base}#${count}`, control]);
	}
	return keyed;
}

/** What the document's controls hold now. */
export function collectFieldState(doc: Document): FieldState {
	const fields: FieldValue[] = [];
	let chars = 0;
	for (const [key, control] of fieldKeys(doc)) {
		if (fields.length >= MAX_FIELDS) break;
		if (control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')) {
			fields.push({ key, checked: control.checked });
			continue;
		}
		const value = control.value;
		chars += value.length;
		if (chars > MAX_FIELD_CHARS) break;
		fields.push({ key, value });
	}
	const view = doc.defaultView;
	return { fields, scrollX: view?.scrollX ?? 0, scrollY: view?.scrollY ?? 0 };
}

/**
 * Put values back into the controls they came from, telling the page as a
 * person's typing would, so a page that keeps its own copy of a value hears of
 * it. Returns the keys that had no control to go to yet.
 */
export function applyFieldState(doc: Document, state: FieldState, only?: ReadonlySet<string>): string[] {
	const controls = new Map(fieldKeys(doc));
	const missing: string[] = [];
	for (const field of state.fields) {
		if (only !== undefined && !only.has(field.key)) continue;
		const control = controls.get(field.key);
		if (control === undefined) {
			missing.push(field.key);
			continue;
		}
		if (typeof field.checked === 'boolean' && control instanceof HTMLInputElement) {
			if (control.checked === field.checked) continue;
			control.checked = field.checked;
		} else if (typeof field.value === 'string') {
			if (control.value === field.value) continue;
			// Through the element's own setter: a framework that wraps `value`
			// on the instance would otherwise swallow the change.
			const prototype =
				control instanceof HTMLTextAreaElement
					? HTMLTextAreaElement.prototype
					: control instanceof HTMLSelectElement
						? HTMLSelectElement.prototype
						: HTMLInputElement.prototype;
			const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
			if (setter === undefined) control.value = field.value;
			else setter.call(control, field.value);
		} else continue;
		control.dispatchEvent(new Event('input', { bubbles: true }));
		control.dispatchEvent(new Event('change', { bubbles: true }));
	}
	return missing;
}

/** A state that arrived from another sandbox, checked before it is used. */
export function parseFieldState(value: unknown): FieldState | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const { fields, scrollX, scrollY } = value as Record<string, unknown>;
	if (!Array.isArray(fields) || fields.length > MAX_FIELDS) return undefined;
	const parsed: FieldValue[] = [];
	let chars = 0;
	for (const field of fields) {
		if (typeof field !== 'object' || field === null) return undefined;
		const { key, value: text, checked } = field as Record<string, unknown>;
		if (typeof key !== 'string' || key.length === 0 || key.length > 512) return undefined;
		if (typeof checked === 'boolean') parsed.push({ key, checked });
		else if (typeof text === 'string') {
			chars += text.length;
			if (chars > MAX_FIELD_CHARS) return undefined;
			parsed.push({ key, value: text });
		} else return undefined;
	}
	const position = (candidate: unknown): number =>
		typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
			? Math.min(candidate, 10_000_000)
			: 0;
	return { fields: parsed, scrollX: position(scrollX), scrollY: position(scrollY) };
}
