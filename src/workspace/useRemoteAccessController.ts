import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteAccessStatusClient } from '../services/remoteAccessStatusClient';
import type { RemoteAccessStatus } from '../types/terminay';

export function useRemoteAccessController(
	statusClient: RemoteAccessStatusClient | undefined,
	openSettings: (sectionId: string) => Promise<void>,
) {
	const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [isToggling, setIsToggling] = useState(false);
	const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
	const [pairingOutcome, setPairingOutcome] = useState<'idle' | 'success'>(
		'idle',
	);
	const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
	const [isResettingIdentity, setIsResettingIdentity] = useState(false);
	const [isLinkCopied, setIsLinkCopied] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement | null>(null);

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
	const previousPairedDeviceCountRef = useRef<number | null>(null);
	const [heldQrCodeDataUrl, setHeldQrCodeDataUrl] = useState<string | null>(
		null,
	);
	const freezeHeldQrRef = useRef(false);
	const closePairingModal = useCallback(() => {
		setIsPairingModalOpen(false);
		setPairingOutcome('idle');
		setHeldQrCodeDataUrl(null);
		freezeHeldQrRef.current = false;
	}, []);
	useEffect(() => {
		const current = status?.activeConnectionCount ?? null;
		const previous = previousConnectionCountRef.current;
		previousConnectionCountRef.current = current;
		const paired = status?.pairedDeviceCount ?? null;
		const previousPaired = previousPairedDeviceCountRef.current;
		previousPairedDeviceCountRef.current = paired;
		const pairedGrew =
			previousPaired !== null && paired !== null && paired > previousPaired;
		const connectionsGrew =
			previous !== null && current !== null && current > previous;
		if (isPairingModalOpen && (connectionsGrew || pairedGrew)) {
			setPairingOutcome('success');
			const reduceMotion = window.matchMedia(
				'(prefers-reduced-motion: reduce)',
			).matches;
			const timer = window.setTimeout(
				() => {
					closePairingModal();
				},
				reduceMotion ? 600 : 1700,
			);
			return () => window.clearTimeout(timer);
		}
	}, [
		closePairingModal,
		isPairingModalOpen,
		status?.activeConnectionCount,
		status?.pairedDeviceCount,
	]);

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
			const next = await statusClient.toggleServer();
			setStatus(next);
			setActionError(next.errorMessage);
		} catch (error) {
			recordFailure(error);
		} finally {
			setIsToggling(false);
		}
	}, [
		openSettings,
		recordFailure,
		status?.configurationIssue,
		status?.isRunning,
		status?.webRtcStatus,
		status?.webRtcStatusMessage,
		statusClient,
	]);

	const revokeDevice = useCallback(
		async (deviceId: string) => {
			if (statusClient === undefined) {
				recordFailure(
					new Error('Remote access controls are unavailable in this host.'),
				);
				return;
			}
			try {
				const next = await statusClient.revokeDevice(deviceId);
				setStatus(next);
				setActionError(next.errorMessage);
			} catch (error) {
				recordFailure(error);
			}
		},
		[recordFailure, statusClient],
	);

	const closeConnection = useCallback(
		async (connectionId: string) => {
			if (statusClient === undefined) {
				recordFailure(
					new Error('Remote access controls are unavailable in this host.'),
				);
				return;
			}
			try {
				const next = await statusClient.closeConnection(connectionId);
				setStatus(next);
				setActionError(next.errorMessage);
			} catch (error) {
				recordFailure(error);
			}
		},
		[recordFailure, statusClient],
	);

	/** Approve or deny exactly the pending request whose code the administrator
	 * compared. A request that expired meanwhile reports that instead of
	 * approving whatever replaced it. */
	const decideApproval = useCallback(
		async (approvalId: string, decision: 'approve' | 'deny') => {
			if (statusClient === undefined) {
				recordFailure(
					new Error('Remote access controls are unavailable in this host.'),
				);
				return;
			}
			setBusyApprovalId(approvalId);
			setActionError(null);
			try {
				const next =
					decision === 'approve'
						? await statusClient.approveDevice(approvalId)
						: await statusClient.denyDevice(approvalId);
				setStatus(next);
				setActionError(next.errorMessage);
			} catch (error) {
				recordFailure(error);
			} finally {
				setBusyApprovalId(null);
			}
		},
		[recordFailure, statusClient],
	);
	const approveDevice = useCallback(
		(approvalId: string) => decideApproval(approvalId, 'approve'),
		[decideApproval],
	);
	const denyDevice = useCallback(
		(approvalId: string) => decideApproval(approvalId, 'deny'),
		[decideApproval],
	);

	const resetIdentity = useCallback(async () => {
		if (statusClient === undefined) {
			recordFailure(
				new Error('Remote access controls are unavailable in this host.'),
			);
			return;
		}
		setIsResettingIdentity(true);
		setActionError(null);
		try {
			const next = await statusClient.resetIdentity();
			setStatus(next);
			setActionError(next.errorMessage);
		} catch (error) {
			recordFailure(error);
		} finally {
			setIsResettingIdentity(false);
		}
	}, [recordFailure, statusClient]);

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
			setIsToggling(true);
			try {
				next = next?.isRunning
					? await statusClient.createPairingLink()
					: await statusClient.toggleServer();
				setStatus(next);
				setActionError(next.errorMessage);
			} finally {
				setIsToggling(false);
			}
			if (next?.webRtcPairingUrl || next?.webRtcPairingQrCodeDataUrl) {
				setPairingOutcome('idle');
				setIsPairingModalOpen(true);
			}
		} catch (error) {
			recordFailure(error);
		}
	}, [openSettings, recordFailure, status, statusClient]);

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
		if (!isPairingModalOpen) {
			freezeHeldQrRef.current = false;
			setHeldQrCodeDataUrl(null);
			return;
		}
		if (pairingOutcome === 'success') freezeHeldQrRef.current = true;
		if (
			heldQrCodeDataUrl &&
			status?.webRtcStatus !== undefined &&
			status.webRtcStatus !== 'pairing-ready'
		) {
			freezeHeldQrRef.current = true;
		}
		if (freezeHeldQrRef.current) return;
		const next = pairingQrCodeDataUrl ?? generatedQrCodeDataUrl;
		if (next) setHeldQrCodeDataUrl(next);
	}, [
		generatedQrCodeDataUrl,
		heldQrCodeDataUrl,
		isPairingModalOpen,
		pairingOutcome,
		pairingQrCodeDataUrl,
		status?.webRtcStatus,
	]);

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

	const liveQrCodeDataUrl = pairingQrCodeDataUrl ?? generatedQrCodeDataUrl;
	const visibleQrCodeDataUrl = isPairingModalOpen
		? (heldQrCodeDataUrl ?? liveQrCodeDataUrl)
		: status?.webRtcStatus === 'pairing-ready'
			? liveQrCodeDataUrl
			: null;
	const pendingApprovals = status?.pendingApprovals ?? [];

	return {
		actionError,
		approveDevice,
		busyApprovalId,
		closeMenu,
		closePairingModal,
		closeConnection,
		denyDevice,
		isLinkCopied,
		isMenuOpen,
		isPairingModalOpen,
		isResettingIdentity,
		isToggling,
		menuRef: menuRef as RefObject<HTMLDivElement>,
		openPairingQr,
		pairingExpiresAt,
		pairingOutcome,
		pairingUrl,
		pendingApprovals,
		/** The request currently shown in place of the QR, if any. */
		pendingApproval: pendingApprovals[0] ?? null,
		resetIdentity,
		revokeDevice,
		setIsLinkCopied,
		setIsMenuOpen,
		setIsPairingModalOpen,
		status,
		statusMessage:
			actionError ??
			status?.errorMessage ??
			status?.webRtcStatusMessage ??
			null,
		toggleExposure,
		tone: status?.isRunning
			? 'remote-access-button--active'
			: status?.configurationIssue || status?.errorMessage || actionError
				? 'remote-access-button--warning'
				: '',
		visibleQrCodeDataUrl,
	};
}
