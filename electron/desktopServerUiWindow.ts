import type { TerminayHostActionRequest, TerminayHostContext } from '@terminay/protocol';
import { type CreateServerUiWindowOptions, createServerUiWindow } from './serverUiHost';

export type CreateDesktopServerUiWindowOptions = Omit<CreateServerUiWindowOptions, 'onHostAction'> & {
	readonly context: TerminayHostContext;
	readonly onHostAction?: (request: TerminayHostActionRequest, context: TerminayHostContext) => Promise<unknown> | unknown;
};

/** The sole production window composition for verified Local and remote
 * bundles. Feature-level connection actions belong to the selected bundle;
 * Desktop receives only canonical semantic host requests. */
export function createDesktopServerUiWindow(options: CreateDesktopServerUiWindowOptions) {
	return createServerUiWindow(options);
}
