import type { FormEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	isRemoteAccessPairingPinConfigured,
	PAIRING_PIN_PATTERN,
	type RemotePairingPinClient,
	saveRemoteAccessPairingPin,
} from '../remotePairingPin';
import type { RemoteAccessStatusClient } from '../services/remoteAccessStatusClient';
import type { RemoteAccessStatus } from '../types/terminay';

export function useRemoteAccessController(
	pairingPinClient: RemotePairingPinClient | undefined,
	statusClient: RemoteAccessStatusClient | undefined,
	openSettings: (sectionId: string) => Promise<void>,
) {
	const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [isToggling, setIsToggling] = useState(false);
	const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
	const [isPinModalOpen, setIsPinModalOpen] = useState(false);
	const [pinInput, setPinInput] = useState('');
	const [pinError, setPinError] = useState<string | null>(null);
	const [isSavingPin, setIsSavingPin] = useState(false);
	const [isLinkCopied, setIsLinkCopied] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const pinRequestRef = useRef<((configured: boolean) => void) | null>(null);

	const closeMenu = useCallback(() => setIsMenuOpen(false), []);

	useEffect(() => {
		if (statusClient === undefined) {
			setStatus(null);
			return;
		}
		let mounted = true;
		void statusClient.getStatus().then((next) => {
			if (mounted) setStatus(next);
		});
		const unsubscribe = statusClient.subscribe(setStatus);
		return () => {
			mounted = false;
			unsubscribe?.();
		};
	}, [statusClient]);

	const previousConnectionCountRef = useRef<number | null>(null);
	useEffect(() => {
		const current = status?.activeConnectionCount ?? null;
		const previous = previousConnectionCountRef.current;
		if (
			previous !== null &&
			current !== null &&
			current > previous &&
			isPairingModalOpen
		) {
			setIsPairingModalOpen(false);
		}
		previousConnectionCountRef.current = current;
	}, [status?.activeConnectionCount, isPairingModalOpen]);

	const closePinModal = useCallback((configured: boolean) => {
		pinRequestRef.current?.(configured);
		pinRequestRef.current = null;
		setIsPinModalOpen(false);
		setPinInput('');
		setPinError(null);
		setIsSavingPin(false);
	}, []);

	const ensurePin = useCallback(async () => {
		if (pairingPinClient === undefined) {
			setActionError('Remote access pairing is unavailable in this host.');
			return false;
		}
		if (await isRemoteAccessPairingPinConfigured(pairingPinClient)) return true;
		setPinInput('');
		setPinError(null);
		setIsPinModalOpen(true);
		return new Promise<boolean>((resolve) => {
			pinRequestRef.current = resolve;
		});
	}, [pairingPinClient]);

	const submitPin = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const pin = pinInput.trim();
			if (!PAIRING_PIN_PATTERN.test(pin)) {
				setPinError('Pairing PIN must be exactly 6 digits.');
				return;
			}
			setIsSavingPin(true);
			setPinError(null);
			try {
				if (pairingPinClient === undefined) {
					throw new Error('Remote access pairing is unavailable in this host.');
				}
				await saveRemoteAccessPairingPin(pairingPinClient, pin);
				closePinModal(true);
			} catch (error) {
				setPinError(
					error instanceof Error
						? error.message
						: 'Could not save the pairing PIN.',
				);
				setIsSavingPin(false);
			}
		},
		[closePinModal, pairingPinClient, pinInput],
	);

	const recordFailure = useCallback((error: unknown) => {
		const message =
			error instanceof Error
				? error.message
				: 'Unable to change remote access.';
		setActionError(message);
		setStatus((current) =>
			current ? { ...current, errorMessage: message } : current,
		);
	}, []);

	const toggleExposure = useCallback(async () => {
		setIsToggling(true);
		setActionError(null);
		try {
			if (statusClient === undefined) {
				throw new Error('Remote access controls are unavailable in this host.');
			}
			if (!status?.isRunning && status?.webRtcStatus === 'error') {
				throw new Error(
					status.webRtcStatusMessage ??
						'WebRTC exposure is unavailable in this build.',
				);
			}
			if (status?.configurationIssue) {
				await openSettings('remote-access-host');
				return;
			}
			if (!status?.isRunning && !(await ensurePin())) return;
			const next = await statusClient.toggleServer();
			setStatus(next);
			setActionError(next.errorMessage);
		} catch (error) {
			recordFailure(error);
		} finally {
			setIsToggling(false);
		}
	}, [
		ensurePin,
		openSettings,
		recordFailure,
		status?.configurationIssue,
		status?.isRunning,
		status?.webRtcStatus,
		status?.webRtcStatusMessage,
		statusClient,
	]);

	const openPairingQr = useCallback(async () => {
		setActionError(null);
		try {
			if (statusClient === undefined) {
				throw new Error('Remote access controls are unavailable in this host.');
			}
			if (!status?.isRunning && status?.webRtcStatus === 'error') {
				throw new Error(
					status.webRtcStatusMessage ??
						'WebRTC exposure is unavailable in this build.',
				);
			}
			if (status?.configurationIssue) {
				await openSettings('remote-access-host');
				return;
			}
			let next = status;
			if (!next?.isRunning) {
				if (!(await ensurePin())) return;
				setIsToggling(true);
				try {
					next = await statusClient.toggleServer();
					setStatus(next);
					setActionError(next.errorMessage);
				} finally {
					setIsToggling(false);
				}
			}
			if (next?.webRtcPairingUrl || next?.webRtcPairingQrCodeDataUrl) {
				setIsPairingModalOpen(true);
			}
		} catch (error) {
			recordFailure(error);
		}
	}, [ensurePin, openSettings, recordFailure, status, statusClient]);

	const pairingUrl = status?.webRtcPairingUrl;
	const pairingQrCodeDataUrl = status?.webRtcPairingQrCodeDataUrl;
	const pairingExpiresAt = status?.webRtcPairingExpiresAt;
	const [generatedQrCodeDataUrl, setGeneratedQrCodeDataUrl] = useState<
		string | null
	>(null);

	useEffect(() => {
		let active = true;
		if (!pairingUrl || pairingQrCodeDataUrl) {
			setGeneratedQrCodeDataUrl(null);
			return () => {
				active = false;
			};
		}
		void import('qrcode')
			.then((module) =>
				module.default.toDataURL(pairingUrl, {
					errorCorrectionLevel: 'M',
					margin: 2,
					width: 320,
				}),
			)
			.then((dataUrl) => {
				if (active) setGeneratedQrCodeDataUrl(dataUrl);
			})
			.catch(() => {
				if (active) setGeneratedQrCodeDataUrl(null);
			});
		return () => {
			active = false;
		};
	}, [pairingQrCodeDataUrl, pairingUrl]);

	useEffect(() => {
		if (!isMenuOpen) return;
		const onPointerDown = (event: globalThis.MouseEvent) => {
			if (!menuRef.current?.contains(event.target as Node))
				setIsMenuOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setIsMenuOpen(false);
		};
		window.addEventListener('mousedown', onPointerDown);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('mousedown', onPointerDown);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [isMenuOpen]);

	return {
		actionError,
		closeMenu,
		closePinModal,
		isLinkCopied,
		isMenuOpen,
		isPairingModalOpen,
		isPinModalOpen,
		isSavingPin,
		isToggling,
		menuRef: menuRef as RefObject<HTMLDivElement>,
		openPairingQr,
		pairingExpiresAt,
		pairingUrl,
		pinError,
		pinInput,
		setIsLinkCopied,
		setIsMenuOpen,
		setIsPairingModalOpen,
		setPinError,
		setPinInput,
		status,
		statusMessage:
			actionError ??
			status?.errorMessage ??
			status?.webRtcStatusMessage ??
			null,
		submitPin,
		toggleExposure,
		tone: status?.isRunning
			? 'remote-access-button--active'
			: status?.configurationIssue || status?.errorMessage || actionError
				? 'remote-access-button--warning'
				: '',
		visibleQrCodeDataUrl:
			status?.webRtcStatus === 'pairing-ready'
				? (pairingQrCodeDataUrl ?? generatedQrCodeDataUrl)
				: null,
	};
}
