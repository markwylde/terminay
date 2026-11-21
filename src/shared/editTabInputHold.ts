/**
 * Whether a tab editor is open and waiting for the person's input. While it
 * is, a delayed focus restore must not move focus into a terminal, or what is
 * typed into the editor reaches the shell.
 */
let awaitingInput = false;

export function setEditTabAwaitingInput(value: boolean): void {
	awaitingInput = value;
}

export function isEditTabAwaitingInput(): boolean {
	return awaitingInput;
}
