import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

/**
 * The few questions the installer asks.
 *
 * A prompt appears only when standard input is a terminal and the answer was
 * not given as a flag. Without a terminal the CLI requires the flag instead of
 * choosing for the operator, because both questions it asks — install scope
 * and the account terminals run as — decide what the daemon can reach.
 */

export interface PromptStreams {
	readonly input: Readable & { isTTY?: boolean };
	readonly output: Writable;
}

export function defaultStreams(): PromptStreams {
	return { input: process.stdin, output: process.stdout };
}

export function isInteractive(
	streams: PromptStreams = defaultStreams(),
): boolean {
	return streams.input.isTTY === true;
}

async function ask(question: string, streams: PromptStreams): Promise<string> {
	const rl = createInterface({ input: streams.input, output: streams.output });
	try {
		return await new Promise<string>((resolve) =>
			rl.question(question, resolve),
		);
	} finally {
		rl.close();
	}
}

/** Enter accepts the first choice, which is always the safer default. */
export async function choose<T extends string>(
	question: string,
	choices: readonly (readonly [T, string])[],
	streams: PromptStreams = defaultStreams(),
): Promise<T> {
	const [first] = choices;
	if (first === undefined)
		throw new Error('a choice needs at least one option');
	const lines = choices.map(
		([value, label], index) =>
			`  ${index + 1}) ${label}${index === 0 ? ' [default]' : ''}  (${value})`,
	);
	for (;;) {
		const answer = (await ask(`${question}\n${lines.join('\n')}\n> `, streams))
			.trim()
			.toLowerCase();
		if (answer.length === 0) return first[0];
		const byNumber = choices[Number(answer) - 1];
		if (/^\d+$/u.test(answer) && byNumber !== undefined) return byNumber[0];
		const byName = choices.find(([value]) => value === answer);
		if (byName !== undefined) return byName[0];
		streams.output.write(
			`Please answer with a number from 1 to ${choices.length}, or a name.\n`,
		);
	}
}

export async function confirm(
	question: string,
	streams: PromptStreams = defaultStreams(),
	fallback = false,
): Promise<boolean> {
	const suffix = fallback ? '[Y/n]' : '[y/N]';
	const answer = (await ask(`${question} ${suffix} `, streams))
		.trim()
		.toLowerCase();
	if (answer.length === 0) return fallback;
	return answer === 'y' || answer === 'yes';
}
