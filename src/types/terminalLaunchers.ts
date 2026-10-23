/**
 * A way to start a new terminal that the selected server offers, such as an
 * installed coding agent. The server decides what it runs; a client only ever
 * names it by id.
 */
export interface TerminalLauncherView {
	/** Namespaced by the contributing extension, e.g. `com.terminay.builtin-agents/launch-codex`. */
	id: string;
	/** The name a button and its tooltip show, e.g. `Codex`. */
	displayName: string;
	/** An id from Terminay's icon allowlist. An id this client does not know draws as a terminal. */
	icon: string;
}
