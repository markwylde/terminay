/**
 * Carrying a project creation across a lost connection.
 *
 * A command sent as its connection dies comes back outcome-unknown: the
 * server may or may not have applied it. A creation names the project it
 * creates, so the snapshot read after reconnecting says which, and the client
 * never has to guess or show the person a protocol error.
 */

/** How many times one creation may be interrupted before it is given up. */
export const PROJECT_CREATION_MAX_INTERRUPTIONS = 3;

export const PROJECT_CREATION_UNCONFIRMED_MESSAGE =
	"Couldn't confirm the project was created. Check the connection and try again.";

/** What the owning server says once the workspace has resynchronised. `null`
 * means the connection is not coming back on its own. */
export type ResynchronisedProject = Readonly<{
	exists: boolean;
	/** A terminal the project already has, if any. */
	terminalSessionId?: string;
}> | null;

export type InterruptedCreationDecision =
	| Readonly<{ kind: 'continue' }>
	| Readonly<{ kind: 'resend' }>
	| Readonly<{ kind: 'fail'; message: string }>;

/** The transport went away under a request; nothing was refused. */
export function isConnectionLoss(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as { code?: unknown }).code;
	return (
		error.name === 'CommandOutcomeUnknownError' ||
		error.name === 'ClientDisconnectedError' ||
		code === 'unknown_command_outcome' ||
		code === 'disconnected'
	);
}

/**
 * Decide what an interrupted step does next. `done` is whether the snapshot
 * shows the step's effect: the project for the create step, a terminal for the
 * launch step.
 */
export function resolveInterruptedCreation(
	input: Readonly<{
		interruptions: number;
		reachable: boolean;
		done: boolean;
	}>,
): InterruptedCreationDecision {
	if (!input.reachable)
		return { kind: 'fail', message: PROJECT_CREATION_UNCONFIRMED_MESSAGE };
	if (input.done) return { kind: 'continue' };
	if (input.interruptions >= PROJECT_CREATION_MAX_INTERRUPTIONS)
		return { kind: 'fail', message: PROJECT_CREATION_UNCONFIRMED_MESSAGE };
	return { kind: 'resend' };
}

export type ProjectCreationSteps = Readonly<{
	/** Send the creation on the connection that is current now. */
	create: () => Promise<void>;
	/** Launch the project's first terminal and resolve with its session. */
	launchTerminal: () => Promise<string>;
	/** Wait for the owning connection to be ready and resynchronised. */
	resynchronise: () => Promise<ResynchronisedProject>;
	/** The server has the project; the pending tab can bind to it. */
	onProjectCreated?: () => void;
}>;

/**
 * Create a project and its first terminal, exactly once, however many times
 * the connection is replaced underneath. Resolves with the terminal session.
 * Rejects with the server's own error when it refuses, and with the plain
 * unconfirmed message when recovery gives up.
 */
export async function createProjectAcrossReconnects(
	steps: ProjectCreationSteps,
): Promise<string> {
	let interruptions = 0;
	const interrupted = async (
		done: (project: NonNullable<ResynchronisedProject>) => boolean,
	): Promise<NonNullable<ResynchronisedProject> | 'resend'> => {
		interruptions += 1;
		const project = await steps.resynchronise();
		const decision = resolveInterruptedCreation({
			interruptions,
			reachable: project !== null,
			done: project !== null && done(project),
		});
		if (decision.kind === 'fail') throw new Error(decision.message);
		if (decision.kind === 'resend' || project === null) return 'resend';
		return project;
	};

	let resent = false;
	for (;;) {
		try {
			await steps.create();
			break;
		} catch (error) {
			if (isConnectionLoss(error)) {
				if ((await interrupted((project) => project.exists)) !== 'resend')
					break;
				resent = true;
				continue;
			}
			// The interrupted send can still land after the snapshot that
			// showed the project absent, and the server then refuses the
			// resend as a duplicate. The project existing is the answer.
			if (resent && (await steps.resynchronise())?.exists === true) break;
			throw error;
		}
	}
	steps.onProjectCreated?.();

	for (;;) {
		try {
			return await steps.launchTerminal();
		} catch (error) {
			if (!isConnectionLoss(error)) throw error;
			const project = await interrupted(
				(candidate) => candidate.terminalSessionId !== undefined,
			);
			if (project !== 'resend' && project.terminalSessionId !== undefined)
				return project.terminalSessionId;
		}
	}
}
