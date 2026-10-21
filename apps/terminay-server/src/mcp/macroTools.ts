import type { ControlError, ControlRequestContext } from './controlEndpoint.js';

/**
 * The macro tools (ADR-0072): list the server's macros, run one against a
 * terminal the caller can address, and cancel a run. Creating, editing and
 * deleting macros stays outside the MCP surface. Parsing lives here; the
 * binding to the macro service lives in macroAdapter.ts.
 */

export type MacroFieldValue = string | number | boolean;
export type ListMacrosParams = Record<string, never>;
export interface RunMacroParams {
	readonly macroId: string;
	/** A terminal handle the caller can address. */
	readonly terminal: string;
	/** Values by field name; a field left out takes its default. */
	readonly values: Readonly<Record<string, MacroFieldValue>>;
}
export interface CancelMacroParams {
	readonly runId: string;
}

type Failure = { readonly ok: false; readonly error: ControlError };
type Parsed<T> = T | Failure;
type Handler<P> = (
	params: P,
	context: ControlRequestContext,
	signal: AbortSignal,
) => unknown | Promise<unknown>;

/** Host binding for the macro tools; each method is already past the MCP
 * permission gate. */
export interface MacroControlAdapter {
	readonly listMacros: Handler<ListMacrosParams>;
	readonly runMacro: Handler<RunMacroParams>;
	readonly cancelMacro: Handler<CancelMacroParams>;
}

/** The tools a `MacroControlAdapter` binds; without one they are unavailable. */
export const MACRO_CONTROL_OPERATIONS = Object.freeze([
	'list_macros',
	'run_macro',
	'cancel_macro',
] as const);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_TERMINAL_REF_CHARS = 256;
export const MAX_MACRO_VALUES = 128;
export const MAX_MACRO_VALUE_CHARS = 16_384;

export function isMacroParamFailure(value: unknown): value is Failure {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { error?: unknown }).error === 'object'
	);
}

export function parseListMacros(): Parsed<ListMacrosParams> {
	return {};
}

export function parseRunMacro(
	params: Record<string, unknown>,
): Parsed<RunMacroParams> {
	if (typeof params.macro_id !== 'string' || !ID_PATTERN.test(params.macro_id))
		return badRequest('macro_id must be a macro id from list_macros');
	const terminal = params.terminal;
	if (
		typeof terminal !== 'string' ||
		terminal.trim().length === 0 ||
		terminal.length > MAX_TERMINAL_REF_CHARS ||
		terminal.includes('\0')
	)
		return badRequest('terminal must be a terminal handle from list_terminals');
	const values = params.values ?? {};
	if (typeof values !== 'object' || values === null || Array.isArray(values))
		return badRequest('values must map field names to values');
	const entries = Object.entries(values);
	if (entries.length > MAX_MACRO_VALUES)
		return badRequest(`values may name at most ${MAX_MACRO_VALUES} fields`);
	for (const [name, value] of entries) {
		if (name.length === 0 || name.length > 256 || name.includes('\0'))
			return badRequest('values names a field that cannot exist');
		if (
			!(
				(typeof value === 'string' && value.length <= MAX_MACRO_VALUE_CHARS) ||
				typeof value === 'boolean' ||
				(typeof value === 'number' && Number.isFinite(value))
			)
		)
			return badRequest(
				`values.${name.slice(0, 64)} must be a string, number, or boolean`,
			);
	}
	return {
		macroId: params.macro_id,
		terminal,
		values: values as Record<string, MacroFieldValue>,
	};
}

export function parseCancelMacro(
	params: Record<string, unknown>,
): Parsed<CancelMacroParams> {
	return typeof params.run_id === 'string' && ID_PATTERN.test(params.run_id)
		? { runId: params.run_id }
		: badRequest('run_id must be a macro run id from run_macro');
}

export function macroFailure(
	code: ControlError['code'],
	message: string,
): Failure {
	return { ok: false, error: { code, message } };
}

function badRequest(message: string): Failure {
	return macroFailure('bad_request', message);
}
