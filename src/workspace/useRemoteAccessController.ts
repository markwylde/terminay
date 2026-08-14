import type { JsonValue } from '@terminay/protocol';
import type { FormEvent, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalSettingsClient } from '../hooks/useTerminalSettings';
import {
	isRemoteAccessPairingPinConfigured,
	PAIRING_PIN_PATTERN,
	type RemotePairingPinClient,
	saveRemoteAccessPairingPin,
} from '../remotePairingPin';
import type { RemoteAccessStatusClient } from '../services/remoteAccessStatusClient';
import type { TerminalSettings } from '../types/settings';
import type { RemoteAccessStatus } from '../types/terminay';

export type RemotePairingMode = 'lan' | 'webrtc';
export function useRemoteAccessController(
	pairingPinClient: RemotePairingPinClient | undefined,
	statusClient: RemoteAccessStatusClient | undefined,
	settingsClient: TerminalSettingsClient,
) {
	const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
	const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [isToggling, setIsToggling] = useState(false);
	const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
	const [isPinModalOpen, setIsPinModalOpen] = useState(false);
	const [pinInput, setPinInput] = useState('');
	const [pinError, setPinError] = useState<string | null>(null);
	const [isSavingPin, setIsSavingPin] = useState(false);
	const [selectedMode, setSelectedMode] = useState<RemotePairingMode>('webrtc');
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

	// The primary exposure journey is always WebRTC. The direct listener is an
	// independently labelled advanced setting, never an alternate QR type.
	useEffect(() => setSelectedMode('webrtc'), []);

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

	const selectMode = useCallback(
		async (mode: RemotePairingMode) => {
			setSelectedMode(mode);
			setActionError(null);
			try {
				if (statusClient === undefined) {
					setActionError(
						'Remote access controls are unavailable in this host.',
					);
					return false;
				}
				const settings = await settingsClient.get<TerminalSettings>();
				if (settings.remoteAccess.pairingMode !== mode) {
					await settingsClient.update<TerminalSettings>({
						...settings,
						remoteAccess: { ...settings.remoteAccess, pairingMode: mode },
					} as unknown as JsonValue);
				}
				setStatus(await statusClient.getStatus());
				return true;
			} catch (error) {
				setActionError(
					error instanceof Error
						? error.message
						: 'Could not save the remote pairing mode.',
				);
				return false;
			}
		},
		[settingsClient, statusClient],
	);

	const closePinModal = useCallback((configured: boolean) => {
		pinRequestRef.current?.(configured);
		pinRequestRef.current = null;
		setIsPinModalOpen(false);
		setPinInput('');
		setPinError(null);
		setIsSavingPin(false);
	}, []);

	const ensurePin = useCallback(
		async (mode: RemotePairingMode) => {
			if (pairingPinClient === undefined) {
				setActionError('Remote access pairing is unavailable in this host.');
				return false;
			}
			if (await isRemoteAccessPairingPinConfigured(pairingPinClient, mode))
				return true;
			setPinInput('');
			setPinError(null);
			setIsPinModalOpen(true);
			return new Promise<boolean>((resolve) => {
				pinRequestRef.current = resolve;
			});
		},
		[pairingPinClient],
	);

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
			error instanceof Error ? error.message : 'Unable to start remote access.';
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
			if (
				!status?.isRunning &&
				selectedMode === 'webrtc' &&
				status?.webRtcStatus === 'error'
			) {
				throw new Error(
					status.webRtcStatusMessage ??
						'WebRTC exposure is unavailable in this build.',
				);
			}
			if (status?.configurationIssue) {
				await window.terminaySettingsWindowHost?.open('remote-access-host');
				return;
			}
			if (!status?.isRunning && !(await selectMode('webrtc'))) return;
			if (!status?.isRunning && !(await ensurePin('webrtc'))) return;
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
		recordFailure,
		selectMode,
		status?.configurationIssue,
		status?.isRunning,
		statusClient,
	]);

	const openPairingQr = useCallback(
		async (_mode: RemotePairingMode = 'webrtc') => {
			const mode: RemotePairingMode = 'webrtc';
			setActionError(null);
			try {
				if (statusClient === undefined) {
					throw new Error(
						'Remote access controls are unavailable in this host.',
					);
				}
				if (
					!status?.isRunning &&
					mode === 'webrtc' &&
					status?.webRtcStatus === 'error'
				) {
					throw new Error(
						status.webRtcStatusMessage ??
							'WebRTC exposure is unavailable in this build.',
					);
				}
				if (status?.configurationIssue) {
					await window.terminaySettingsWindowHost?.open('remote-access-host');
					return;
				}
				if (!(await selectMode(mode))) return;
				let next = status;
				if (!next?.isRunning) {
					if (!(await ensurePin(mode))) return;
					setIsToggling(true);
					try {
						next = await statusClient.toggleServer();
						setStatus(next);
						setActionError(next.errorMessage);
					} finally {
						setIsToggling(false);
					}
				}
				const effectiveMode = next?.pairingMode ?? mode;
				setSelectedMode(effectiveMode);
				const hasPairingQr =
					effectiveMode === 'webrtc'
						? (next?.webRtcPairingUrl ?? next?.webRtcPairingQrCodeDataUrl)
						: (next?.lanPairingUrl ??
							next?.lanPairingQrCodeDataUrl ??
							next?.pairingQrCodeDataUrl);
				if (hasPairingQr) setIsPairingModalOpen(true);
			} catch (error) {
				recordFailure(error);
			}
		},
		[ensurePin, recordFailure, selectMode, selectedMode, status, statusClient],
	);

	const addresses = status?.availableAddresses ?? [];
	const pairingUrl =
		selectedMode === 'webrtc'
			? status?.webRtcPairingUrl
			: (status?.lanPairingUrl ?? status?.pairingUrl);
	const pairingQrCodeDataUrl =
		selectedMode === 'webrtc'
			? status?.webRtcPairingQrCodeDataUrl
			: (status?.lanPairingQrCodeDataUrl ?? status?.pairingQrCodeDataUrl);
	const pairingExpiresAt =
		selectedMode === 'webrtc'
			? status?.webRtcPairingExpiresAt
			: (status?.lanPairingExpiresAt ?? status?.pairingExpiresAt);
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

	const isWebRtcReady =
		selectedMode !== 'webrtc' || status?.webRtcStatus === 'pairing-ready';
	const visibleQrCodeDataUrl = isWebRtcReady
		? (pairingQrCodeDataUrl ?? generatedQrCodeDataUrl)
		: null;
	const webRtcDisplayUrl = useMemo(() => {
		if (!status?.webRtcPairingUrl) return null;
		try {
			return new URL(status.webRtcPairingUrl).origin;
		} catch {
			return 'WebRTC session link ready.';
		}
	}, [status?.webRtcPairingUrl]);
	const preferredAddress = useMemo(() => {
		if (selectedMode === 'webrtc') return webRtcDisplayUrl;
		if (!pairingUrl) return addresses[0] || null;
		try {
			const url = new URL(pairingUrl);
			const origin = url.origin + url.pathname.replace(/\/$/, '');
			return (
				addresses.find((address) => address.startsWith(origin)) ??
				addresses[0] ??
				null
			);
		} catch {
			return addresses[0] || null;
		}
	}, [addresses, pairingUrl, selectedMode, webRtcDisplayUrl]);

	const selectAddress = useCallback(
		async (address: string) => {
			if (statusClient === undefined) {
				setActionError('Remote access controls are unavailable in this host.');
				return;
			}
			setStatus(await statusClient.setPairingAddress(address));
		},
		[statusClient],
	);

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
		addresses,
		closeMenu,
		closePinModal,
		isAdvancedOpen,
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
		preferredAddress,
		selectAddress,
		selectedMode,
		selectMode,
		setIsAdvancedOpen,
		setIsLinkCopied,
		setIsMenuOpen,
		setIsPairingModalOpen,
		setPinError,
		setPinInput,
		status,
		statusMessage:
			actionError ??
			status?.errorMessage ??
			(selectedMode === 'webrtc' ? status?.webRtcStatusMessage : null),
		submitPin,
		toggleExposure,
		tone: status?.isRunning
			? 'remote-access-button--active'
			: status?.configurationIssue || status?.errorMessage || actionError
				? 'remote-access-button--warning'
				: '',
		visibleQrCodeDataUrl,
		webRtcDisplayUrl,
	};
}
