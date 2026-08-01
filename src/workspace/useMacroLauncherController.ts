import { useCallback, useRef, useState } from 'react';
import type { MacroDefinition, MacroFieldValue } from '../types/macros';

type MacroLauncherControllerOptions = {
	executeMacro: (
		macro: MacroDefinition,
		values: Record<string, MacroFieldValue>,
	) => Promise<void>;
	focusActiveTerminal: () => void;
	getActiveSessionId: () => string | null;
	getServerTerminalCwd: (sessionId: string) => Promise<string | null>;
	projectRoot: string;
	setErrorText: (message: string | null) => void;
};

export function useMacroLauncherController({
	executeMacro,
	focusActiveTerminal,
	getActiveSessionId,
	getServerTerminalCwd,
	projectRoot,
	setErrorText,
}: MacroLauncherControllerOptions) {
	const [isMacroLauncherOpen, setIsMacroLauncherOpen] = useState(false);
	const [macroQuery, setMacroQuery] = useState('');
	const [selectedMacroIndex, setSelectedMacroIndex] = useState(0);
	const [macroToRun, setMacroToRun] = useState<MacroDefinition | null>(null);
	const [macroFieldValues, setMacroFieldValues] = useState<
		Record<string, MacroFieldValue>
	>({});
	const [macroFileSearchRootPath, setMacroFileSearchRootPath] = useState('');
	const macroLauncherInputRef = useRef<HTMLInputElement | null>(null);
	const macroLauncherListRef = useRef<HTMLDivElement | null>(null);
	const macroLauncherItemRefs = useRef(
		new Map<string, HTMLButtonElement | null>(),
	);
	const firstMacroFieldRef = useRef<
		HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
	>(null);

	const closeMacroLauncher = useCallback(() => {
		setIsMacroLauncherOpen(false);
		setMacroQuery('');
		setSelectedMacroIndex(0);
		window.requestAnimationFrame(focusActiveTerminal);
	}, [focusActiveTerminal]);

	const closeMacroParameterModal = useCallback(() => {
		setMacroToRun(null);
		setMacroFieldValues({});
		setMacroFileSearchRootPath('');
		window.requestAnimationFrame(focusActiveTerminal);
	}, [focusActiveTerminal]);

	const runMacro = useCallback(
		async (macro: MacroDefinition) => {
			if (macro.fields.length === 0) {
				await executeMacro(macro, {});
				return;
			}

			let searchRootPath = projectRoot;
			const activeSessionId = getActiveSessionId();
			if (activeSessionId) {
				try {
					searchRootPath =
						(await getServerTerminalCwd(activeSessionId)) ?? projectRoot;
				} catch {
					searchRootPath = projectRoot;
				}
			}

			setMacroToRun(macro);
			setMacroFileSearchRootPath(searchRootPath);
			setMacroFieldValues(
				Object.fromEntries(
					macro.fields.map((field) => [field.name, field.defaultValue]),
				) as Record<string, MacroFieldValue>,
			);
			setIsMacroLauncherOpen(false);
		},
		[executeMacro, getActiveSessionId, getServerTerminalCwd, projectRoot],
	);

	const validateMacroValues = useCallback(
		(macro: MacroDefinition, values: Record<string, MacroFieldValue>) => {
			for (const field of macro.fields) {
				if (!field.required) continue;
				const value = values[field.name];
				const missing =
					value === undefined ||
					value === null ||
					(typeof value === 'string' && value.trim().length === 0);
				if (!missing) continue;
				setErrorText(`"${field.label}" is required before this macro can run.`);
				return false;
			}
			return true;
		},
		[setErrorText],
	);

	return {
		closeMacroLauncher,
		closeMacroParameterModal,
		firstMacroFieldRef,
		isMacroLauncherOpen,
		macroFieldValues,
		macroFileSearchRootPath,
		macroLauncherInputRef,
		macroLauncherItemRefs,
		macroLauncherListRef,
		macroQuery,
		macroToRun,
		runMacro,
		selectedMacroIndex,
		setIsMacroLauncherOpen,
		setMacroFieldValues,
		setMacroFileSearchRootPath,
		setMacroQuery,
		setMacroToRun,
		setSelectedMacroIndex,
		validateMacroValues,
	};
}
