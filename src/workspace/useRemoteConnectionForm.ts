import { type FormEvent, useCallback, useState } from 'react';

/** Owns the complete add-remote-server form lifecycle and connection command. */
export function useRemoteConnectionForm(closeMenu: () => void) {
	const [isOpen, setIsOpen] = useState(false);
	const [url, setUrl] = useState('');
	const [pairingPin, setPairingPin] = useState('');
	const [notice, setNotice] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isOpening, setIsOpening] = useState(false);

	const reset = useCallback(() => {
		setUrl('');
		setPairingPin('');
		setNotice(null);
		setError(null);
	}, []);

	const open = useCallback(() => {
		closeMenu();
		reset();
		setIsOpen(true);
	}, [closeMenu, reset]);

	const close = useCallback(() => {
		if (isOpening) return;
		setIsOpen(false);
		reset();
	}, [isOpening, reset]);

	const submit = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			setError(null);
			setIsOpening(true);
			try {
				await window.terminayConnectionHost.open(
					url.trim(),
					pairingPin || undefined,
				);
				setIsOpen(false);
				setUrl('');
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: 'Unable to open the remote Terminay server.',
				);
			} finally {
				setIsOpening(false);
			}
		},
		[pairingPin, url],
	);

	return {
		close,
		error,
		isOpen,
		isOpening,
		notice,
		open,
		pairingPin,
		setError,
		setNotice,
		setPairingPin,
		setUrl,
		submit,
		url,
	};
}
