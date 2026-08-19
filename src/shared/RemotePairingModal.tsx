import {
	type CSSProperties,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from 'react';
import { writeClipboardText } from '../host/nativeActions';
import './RemotePairingModal.css';

export function RemotePairingModal({
	dialogRef,
	dialogStyle,
	expiresAt,
	onClose,
	onTitleMouseDown,
	pairingUrl,
	qrCodeDataUrl,
	statusMessage,
	success = false,
}: Readonly<{
	dialogRef?: (element: HTMLDivElement | null) => void;
	dialogStyle?: CSSProperties;
	expiresAt?: string | null;
	onClose: () => void;
	onTitleMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
	pairingUrl?: string | null;
	qrCodeDataUrl?: string | null;
	statusMessage?: string | null;
	success?: boolean;
}>) {
	const [copied, setCopied] = useState(false);
	const [generatedQr, setGeneratedQr] = useState<string | null>(null);
	const pointerStartedOnBackdropRef = useRef(false);
	useEffect(() => {
		let active = true;
		if (qrCodeDataUrl || !pairingUrl) {
			setGeneratedQr(null);
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
				if (active) setGeneratedQr(dataUrl);
			})
			.catch(() => {
				if (active) setGeneratedQr(null);
			});
		return () => {
			active = false;
		};
	}, [pairingUrl, qrCodeDataUrl]);
	const visibleQr = qrCodeDataUrl ?? generatedQr;
	let body: ReactNode;
	if (visibleQr) {
		body = (
			<div className="remote-pairing-modal__content">
				<div
					className={
						success
							? 'remote-pairing-modal__qr-card remote-pairing-modal__qr-card--success'
							: 'remote-pairing-modal__qr-card'
					}
				>
					<img
						key={visibleQr}
						className="remote-pairing-modal__qr"
						src={visibleQr}
						alt="Remote pairing QR code"
					/>
					{success ? (
						<div
							className="remote-pairing-modal__qr-success"
							role="status"
							aria-live="polite"
						>
							<svg
								className="remote-pairing-modal__success-tick"
								viewBox="0 0 52 52"
								aria-hidden="true"
							>
								<path
									className="remote-pairing-modal__success-check"
									d="M14 27.2l7.2 7.2 16.8-16.8"
								/>
							</svg>
							<p className="remote-pairing-modal__success-title">Connected</p>
						</div>
					) : null}
				</div>
				<div className="remote-pairing-modal__address-section">
					<div className="remote-pairing-modal__address-label">
						One-time pairing link
					</div>
					<div className="remote-pairing-modal__address-box">
						<div className="remote-pairing-modal__address-text">
							{pairingUrl || 'No pairing link available yet.'}
						</div>
						{pairingUrl ? (
							<button
								type="button"
								className="remote-pairing-modal__copy-btn"
								onClick={() => {
									void writeClipboardText(pairingUrl)
										.then(() => {
											setCopied(true);
											window.setTimeout(() => setCopied(false), 2000);
										})
										.catch(() => setCopied(false));
								}}
							>
								{copied ? 'Copied' : 'Copy pairing link'}
							</button>
						) : null}
					</div>
					{expiresAt ? (
						<p className="remote-pairing-modal__expires-text">
							Expires {new Date(expiresAt).toLocaleString()}. A replacement QR
							appears automatically before then.
						</p>
					) : null}
				</div>
			</div>
		);
	} else if (pairingUrl) {
		body = (
			<p className="remote-pairing-modal__copy">
				{statusMessage ?? 'Preparing the secure WebRTC session…'}
			</p>
		);
	} else {
		body = (
			<p className="remote-pairing-modal__copy">
				Expose this server to generate a pairing link.
			</p>
		);
	}

	return (
		<div
			className="remote-pairing-modal-backdrop"
			onMouseDown={(event) => {
				pointerStartedOnBackdropRef.current =
					event.target === event.currentTarget;
			}}
			onMouseUp={(event) => {
				const shouldClose =
					pointerStartedOnBackdropRef.current &&
					event.target === event.currentTarget;
				pointerStartedOnBackdropRef.current = false;
				if (shouldClose) onClose();
			}}
		>
			<div
				className="remote-pairing-modal"
				ref={dialogRef}
				style={dialogStyle}
				onClick={(event) => event.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="pair-device-modal-title"
			>
				<div
					className="remote-pairing-modal__titlebar"
					onMouseDown={onTitleMouseDown}
				>
					<h2
						id="pair-device-modal-title"
						className="remote-pairing-modal__title"
					>
						Pair Device
					</h2>
					<button
						type="button"
						className="remote-pairing-modal__close"
						onClick={onClose}
						aria-label="Close Pair Device"
						title="Close Pair Device"
					>
						<svg
							aria-hidden="true"
							width="12"
							height="12"
							viewBox="0 0 12 12"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M9 3L3 9M3 3L9 9"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</button>
				</div>
				<div className="remote-pairing-modal__container">
					<p className="remote-pairing-modal__copy">
						{success
							? 'That browser is paired. It can reconnect from this server’s stable origin.'
							: 'Use this one-time link to pair a new browser or Desktop device. That device can reconnect later from this server’s stable origin.'}
					</p>
					{body}
				</div>
			</div>
		</div>
	);
}
