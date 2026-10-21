import type { JsonValue } from '@terminay/protocol';
import {
	MACRO_OPERATIONS,
	type MacroDefinition,
	type MacroTarget,
} from '@terminay/server-core';
import { serverControlError } from './appControlAdapter.js';
import {
	ControlEndpointError,
	type ControlRequestContext,
} from './controlEndpoint.js';
import type { MacroControlAdapter, MacroFieldValue } from './macroTools.js';

/**
 * Binds the macro tools (ADR-0072) to the server's macro service, run as the
 * MCP principal. The target terminal is resolved against the caller's reach
 * before anything runs. An MCP run has no launching client, so it is started
 * to continue whatever connection closes: it runs until it finishes, is
 * cancelled, or its terminal closes, even if the caller's capability ends.
 */

export interface MacroControlAdapterOptions {
	readonly query: (
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
	) => Promise<unknown>;
	readonly command: (
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
	) => Promise<unknown>;
	/**
	 * A terminal the caller can address, as the macro service names it.
	 * Throws `terminal_not_found` for one outside the caller's reach.
	 */
	readonly resolveTerminal: (
		context: ControlRequestContext,
		reference: string,
	) => MacroTarget;
}

/** Macros one listing returns. */
export const MAX_LISTED_MACROS = 256;

export function createMacroControlAdapter(
	options: MacroControlAdapterOptions,
): MacroControlAdapter {
	const run = async <T>(work: () => Promise<T>): Promise<T> => {
		try {
			return await work();
		} catch (error) {
			throw serverControlError(error);
		}
	};
	const macros = async (signal: AbortSignal): Promise<MacroDefinition[]> => {
		const state = await run(() =>
			options.query(MACRO_OPERATIONS.get, {}, signal),
		);
		const list = (state as { macros?: unknown } | null)?.macros;
		return Array.isArray(list) ? (list as MacroDefinition[]) : [];
	};

	return {
		listMacros: async (_params, _context, signal) => {
			const all = await macros(signal);
			const listed = all.slice(0, MAX_LISTED_MACROS);
			return {
				macros: listed.map((macro) => ({
					id: macro.id,
					name: macro.title,
					...(macro.category === '' ? {} : { category: macro.category }),
					...(macro.description === ''
						? {}
						: { description: macro.description }),
					fields: macro.fields.map((field) => ({
						name: field.name,
						label: field.label,
						type: field.type,
						required: field.required,
						default: field.defaultValue,
						...(field.description === ''
							? {}
							: { description: field.description }),
						...(field.options.length === 0
							? {}
							: { options: field.options.map((option) => option.value) }),
					})),
				})),
				...(listed.length < all.length ? { truncated: true } : {}),
			};
		},
		runMacro: async (params, context, signal) => {
			// Reach first, so a terminal the caller cannot address reveals
			// nothing about the macro.
			const target = options.resolveTerminal(context, params.terminal);
			const macro = (await macros(signal)).find(
				(candidate) => candidate.id === params.macroId,
			);
			if (macro === undefined)
				throw new ControlEndpointError(
					'not_found',
					'No macro has that id. list_macros lists them.',
				);
			const values = macroValues(macro, params.values);
			const snapshot = (await run(() =>
				options.command(
					MACRO_OPERATIONS.run,
					{
						macroId: macro.id,
						target: { ...target },
						values,
						// No launching client: no disconnect cancels it.
						disconnectPolicy: 'continue',
					} as JsonValue,
					signal,
				),
			)) as { runId?: unknown; status?: unknown } | null;
			return {
				run_id: snapshot?.runId,
				macro: macro.id,
				terminal: target.sessionId,
				status: snapshot?.status,
			};
		},
		cancelMacro: async (params, context, signal) => {
			const runs = await run(() =>
				options.query(MACRO_OPERATIONS.runs, {}, signal),
			);
			const snapshot = (Array.isArray(runs) ? runs : []).find(
				(candidate) =>
					(candidate as { runId?: unknown } | null)?.runId === params.runId,
			) as { target?: MacroTarget } | undefined;
			let target: MacroTarget | undefined;
			try {
				target =
					snapshot?.target === undefined
						? undefined
						: options.resolveTerminal(context, snapshot.target.sessionId);
			} catch {
				target = undefined;
			}
			// A run aimed outside the caller's reach is reported exactly as one
			// that does not exist.
			if (
				target === undefined ||
				target.projectId !== snapshot?.target?.projectId
			)
				throw new ControlEndpointError(
					'not_found',
					'No macro run you can reach is running with that id.',
				);
			const outcome = (await run(() =>
				options.command(
					MACRO_OPERATIONS.cancel,
					{ runId: params.runId, target: { ...target } } as JsonValue,
					signal,
				),
			)) as { canceled?: unknown } | null;
			return { run_id: params.runId, cancelled: outcome?.canceled === true };
		},
	};
}

/**
 * The values a run takes, validated as the macro launch modal validates
 * them: every required field filled, each value of its field's type, a
 * select value one of its options, and no field the macro lacks.
 */
export function macroValues(
	macro: MacroDefinition,
	given: Readonly<Record<string, MacroFieldValue>>,
): Record<string, MacroFieldValue> {
	const known = new Set(macro.fields.map((field) => field.name));
	for (const name of Object.keys(given))
		if (!known.has(name))
			throw new ControlEndpointError(
				'bad_request',
				`This macro has no field named "${name.slice(0, 64)}".`,
			);
	const values: Record<string, MacroFieldValue> = {};
	for (const field of macro.fields) {
		const value = given[field.name] ?? field.defaultValue;
		const missing =
			value === undefined ||
			value === null ||
			(typeof value === 'string' && value.trim().length === 0);
		if (field.required && missing)
			throw new ControlEndpointError(
				'bad_request',
				`"${field.label}" is required before this macro can run.`,
			);
		const fits =
			field.type === 'number'
				? typeof value === 'number'
				: field.type === 'checkbox'
					? typeof value === 'boolean'
					: typeof value === 'string' &&
						(field.type !== 'select' ||
							field.options.length === 0 ||
							value === '' ||
							field.options.some((option) => option.value === value));
		if (!fits)
			throw new ControlEndpointError(
				'bad_request',
				field.type === 'select'
					? `"${field.label}" must be one of: ${field.options.map((option) => option.value).join(', ')}.`
					: `"${field.label}" must be a ${field.type === 'number' ? 'number' : field.type === 'checkbox' ? 'boolean' : 'string'}.`,
			);
		values[field.name] = value;
	}
	return values;
}
