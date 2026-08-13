import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type {
	EditWindowState,
	ProjectEditWindowResult,
	TerminalEditWindowResult,
} from '../types/terminay';

export type AuxiliaryRouteRequest =
	| { readonly kind: 'settings'; readonly sectionId?: string }
	| { readonly kind: 'project-environments' }
	| { readonly kind: 'macros' }
	| { readonly kind: 'recordings' }
	| {
			readonly kind: 'edit-tab';
			readonly state: EditWindowState;
	  };

export type AuxiliaryRouteHandlerResult =
	| ProjectEditWindowResult
	| TerminalEditWindowResult
	| null
	| undefined;

export type AuxiliaryRouteRequestHandler = (
	request: AuxiliaryRouteRequest,
) => Promise<AuxiliaryRouteHandlerResult>;

export type AuxiliaryRouteController = Readonly<{
	openSettings: (sectionId?: string) => Promise<void>;
	openProjectEnvironments: () => Promise<void>;
	openMacros: () => Promise<void>;
	openRecordings: () => Promise<void>;
	editProjectTab: (
		state: Extract<EditWindowState, { readonly kind: 'project' }>,
	) => Promise<ProjectEditWindowResult | null>;
	editTerminalTab: (
		state: Extract<EditWindowState, { readonly kind: 'terminal' }>,
	) => Promise<TerminalEditWindowResult | null>;
}>;

export type AuxiliaryRouteControllerOptions = Readonly<{
	getWindow?: () => Window | undefined;
	onRequest?: AuxiliaryRouteRequestHandler;
}>;

export function createAuxiliaryRouteController({
	getWindow = () => (typeof window === 'undefined' ? undefined : window),
	onRequest,
}: AuxiliaryRouteControllerOptions = {}): AuxiliaryRouteController {
	const requestInPage = async (
		request: AuxiliaryRouteRequest,
	): Promise<AuxiliaryRouteHandlerResult> => {
		if (onRequest === undefined) {
			return request.kind === 'edit-tab' ? null : undefined;
		}
		return onRequest(request);
	};

	return Object.freeze({
		async openSettings(sectionId) {
			const host = getWindow()?.terminaySettingsWindowHost;
			if (host !== undefined) {
				await host.open(sectionId);
				return;
			}
			await requestInPage({ kind: 'settings', sectionId });
		},
		async openProjectEnvironments() {
			const host = getWindow()?.terminayProjectEnvironmentsHost;
			if (host !== undefined) {
				await host.open();
				return;
			}
			await requestInPage({ kind: 'project-environments' });
		},
		async openMacros() {
			await requestInPage({ kind: 'macros' });
		},
		async openRecordings() {
			const host = getWindow()?.terminayRecordingsHost;
			if (host !== undefined) {
				await host.open();
				return;
			}
			await requestInPage({ kind: 'recordings' });
		},
		async editProjectTab(state) {
			const host = getWindow()?.terminayProjectEditHost;
			if (host !== undefined) {
				return host.open({ ...state.draft, projectId: state.projectId });
			}
			const result = await requestInPage({ kind: 'edit-tab', state });
			return (result ?? null) as ProjectEditWindowResult | null;
		},
		async editTerminalTab(state) {
			const host = getWindow()?.terminayTerminalEditHost;
			if (host !== undefined) {
				return host.open(state.draft);
			}
			const result = await requestInPage({ kind: 'edit-tab', state });
			return (result ?? null) as TerminalEditWindowResult | null;
		},
	});
}

const AuxiliaryRouteControllerContext =
	createContext<AuxiliaryRouteController | null>(null);

export function AuxiliaryRouteControllerProvider({
	children,
	controller,
}: Readonly<{
	children: ReactNode;
	controller: AuxiliaryRouteController;
}>) {
	return (
		<AuxiliaryRouteControllerContext.Provider value={controller}>
			{children}
		</AuxiliaryRouteControllerContext.Provider>
	);
}

export function useAuxiliaryRouteController(): AuxiliaryRouteController {
	const controller = useContext(AuxiliaryRouteControllerContext);
	return useMemo(
		() => controller ?? createAuxiliaryRouteController(),
		[controller],
	);
}
